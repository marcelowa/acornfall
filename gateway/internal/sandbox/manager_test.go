package sandbox

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

// fakeDriver stands in for an engine: the lifecycle is ours, so it is tested without one.
type fakeDriver struct {
	calls  []string
	listed []Instance
	err    error
	usable error
	// installed flips to true after Install, so "installs once" can be asserted.
	installed   bool
	installErrs []error
	policy      Policy
}

func (f *fakeDriver) Name() string       { return "fake" }
func (f *fakeDriver) Version() string    { return "1.2.3" }
func (f *fakeDriver) Isolated() bool     { return true }
func (f *fakeDriver) InstallDir() string { return "/home/me/.acornfall/tools/fake/1.2.3" }
func (f *fakeDriver) StateDir() string   { return "/home/me/.acornfall/sandboxes" }
func (f *fakeDriver) Env() []string      { return []string{"FAKE_HOME=" + f.StateDir()} }
func (f *fakeDriver) Installed() bool    { return f.installed }

func (f *fakeDriver) Install(_ context.Context, _ func(string, ...any)) error {
	f.calls = append(f.calls, "install")
	if len(f.installErrs) > 0 {
		err := f.installErrs[0]
		f.installErrs = f.installErrs[1:]
		return err
	}
	f.installed = true
	return nil
}

func (f *fakeDriver) Usable() error { return f.usable }
func (f *fakeDriver) List(context.Context) ([]Instance, error) {
	f.calls = append(f.calls, "list")
	return f.listed, f.err
}
func (f *fakeDriver) Create(_ context.Context, policy Policy, _ string) error {
	f.calls = append(f.calls, "create")
	f.policy = policy
	return f.err
}
func (f *fakeDriver) Start(context.Context, string) error {
	f.calls = append(f.calls, "start")
	return f.err
}
func (f *fakeDriver) Stop(context.Context, string) error {
	f.calls = append(f.calls, "stop")
	return f.err
}
func (f *fakeDriver) Remove(context.Context, string) error {
	f.calls = append(f.calls, "rm")
	return f.err
}

func (f *fakeDriver) ran(call string) bool {
	for _, got := range f.calls {
		if got == call {
			return true
		}
	}
	return false
}

func openWith(t *testing.T, driver Driver) *Manager {
	t.Helper()
	manager, err := Open(context.Background(), Options{Home: t.TempDir(), Driver: driver})
	if err != nil {
		t.Fatal(err)
	}
	return manager
}

// Creating a sandbox is the only thing that needs the engine installed, so that is when the
// download happens: a gateway start must not wait for 26MB it may never use.
func TestProduceInstallsTheEngineOnFirstUseAndOnlyThen(t *testing.T) {
	driver := &fakeDriver{}
	manager := openWith(t, driver)
	if driver.ran("install") {
		t.Error("opening should not install anything")
	}
	if _, err := manager.Produce(context.Background(), Policy{Workspace: "/home/me/work"}, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if !driver.ran("install") {
		t.Error("first use should install the engine")
	}
	if _, err := manager.Produce(context.Background(), Policy{Workspace: "/home/me/work"}, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	installs := 0
	for _, call := range driver.calls {
		if call == "install" {
			installs++
		}
	}
	if installs != 1 {
		t.Errorf("the engine is installed once, got %d calls", installs)
	}
}

func TestProduceCreatesASandboxWhenThereIsNone(t *testing.T) {
	driver := &fakeDriver{}
	manager := openWith(t, driver)
	name, err := manager.Produce(context.Background(), Policy{Workspace: "/home/me/work", Image: "golang:1.24"}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if name != Name("/home/me/work") {
		t.Errorf("name = %q", name)
	}
	if !driver.ran("create") {
		t.Fatal("a missing sandbox should be created")
	}
	if driver.policy.Image != "golang:1.24" {
		t.Errorf("the policy should reach the engine, got %+v", driver.policy)
	}
}

// The sandbox is where a workspace's dependencies and caches live. Recreating it because we
// were asked to make sure it exists would throw that away, so an existing one is started,
// never replaced.
func TestProduceNeverReplacesAnExistingSandbox(t *testing.T) {
	running := &fakeDriver{listed: []Instance{{Name: Name("/home/me/work"), Status: "Running"}}}
	if _, err := openWith(t, running).Produce(context.Background(), Policy{Workspace: "/home/me/work"}, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if running.ran("create") || running.ran("start") {
		t.Errorf("a running sandbox needs nothing, got %v", running.calls)
	}

	stopped := &fakeDriver{listed: []Instance{{Name: Name("/home/me/work"), Status: "Stopped"}}}
	if _, err := openWith(t, stopped).Produce(context.Background(), Policy{Workspace: "/home/me/work"}, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if stopped.ran("create") {
		t.Errorf("a stopped sandbox should be started, not recreated: %v", stopped.calls)
	}
	if !stopped.ran("start") {
		t.Errorf("a stopped sandbox should be started: %v", stopped.calls)
	}
}

func TestProduceRefusesWhenTheSandboxIsUnavailable(t *testing.T) {
	driver := &fakeDriver{usable: fmt.Errorf("%w: /dev/kvm is missing", ErrUnavailable)}
	manager := openWith(t, driver)
	_, err := manager.Produce(context.Background(), Policy{Workspace: "/home/me/work"}, t.TempDir())
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("want the refusal, got %v", err)
	}
	if driver.ran("create") {
		t.Errorf("nothing should be created where a sandbox cannot boot: %v", driver.calls)
	}
	if problem := manager.Problem(); problem == nil {
		t.Error("a refusal has to be reportable, so the interface can say why")
	}
}

func TestStopAndRemoveTolerateAMissingSandbox(t *testing.T) {
	missing := &fakeDriver{err: errors.New("sandbox engine stop x: sandbox not found: x")}
	manager := openWith(t, missing)
	if err := manager.Stop(context.Background(), "/home/me/work"); err != nil {
		t.Errorf("stopping what is not there is already the wanted state: %v", err)
	}
	if err := manager.Remove(context.Background(), "/home/me/work"); err != nil {
		t.Errorf("removing what is not there is already the wanted state: %v", err)
	}

	broken := &fakeDriver{err: errors.New("the engine fell over")}
	if err := openWith(t, broken).Stop(context.Background(), "/home/me/work"); err == nil {
		t.Error("a real engine failure must be reported")
	}
}

func TestStatusFindsTheSandboxByName(t *testing.T) {
	driver := &fakeDriver{listed: []Instance{
		{Name: "someone-elses", Status: "Running"},
		{Name: Name("/home/me/work"), Status: "Stopped"},
	}}
	manager := openWith(t, driver)
	status, err := manager.Status(context.Background(), "/home/me/work")
	if err != nil || status != "Stopped" {
		t.Errorf("status = %q, err = %v", status, err)
	}
	if missing, err := manager.Status(context.Background(), "/home/me/other"); err != nil || missing != "" {
		t.Errorf("a workspace with no sandbox has no status, got %q, %v", missing, err)
	}
}

// Doctor has to be able to describe a machine without changing it, which is the difference
// between a report and an install — and it must not install later either.
func TestReportOnlyDescribesWithoutChangingAnything(t *testing.T) {
	driver := &fakeDriver{}
	manager, err := Open(context.Background(), Options{Home: t.TempDir(), Driver: driver, ReportOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	report := manager.Report()
	if report.Installed || report.Problem == "" {
		t.Errorf("a machine with no engine should report exactly that, got %+v", report)
	}
	if report.Engine != "fake" || report.Version != "1.2.3" || report.StateDir != driver.StateDir() {
		t.Errorf("the report should name the engine, got %+v", report)
	}
	if _, err := manager.Produce(context.Background(), Policy{Workspace: "/home/me/work"}, t.TempDir()); !errors.Is(err, ErrUnavailable) {
		t.Errorf("a report-only manager must refuse to install on use, got %v", err)
	}
	if driver.ran("install") || driver.ran("create") {
		t.Errorf("a report must change nothing, got %v", driver.calls)
	}
}

func TestOpenRefusesWithoutADriverOrHome(t *testing.T) {
	if _, err := Open(context.Background(), Options{Home: t.TempDir()}); err == nil {
		t.Error("a manager with no engine is a mistake, not a state")
	}
	if _, err := Open(context.Background(), Options{Driver: &fakeDriver{}}); err == nil {
		t.Error("a manager with no home has nowhere to install anything")
	}
}
