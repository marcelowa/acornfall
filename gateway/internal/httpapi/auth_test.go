package httpapi

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The token is the boundary for a non-loopback bind, so what it protects against and what it
// deliberately does not are both worth pinning: a loopback bind needs nothing, and exposing
// the port without --insecure always ends up with a token.
func TestResolveToken(t *testing.T) {
	cases := []struct {
		name     string
		explicit string
		env      string
		addr     string
		insecure bool
		want     bool
	}{
		{name: "loopback needs no token", addr: "127.0.0.1:7777"},
		{name: "loopback with ::1 needs none", addr: "[::1]:7777"},
		{name: "localhost needs none", addr: "localhost:7777"},
		// TEST-NET-3, so a test fixture never carries someone's real address.
		{name: "an address off this machine needs one", addr: "203.0.113.7:7777", want: true},
		{name: "binding every interface needs one", addr: "0.0.0.0:7777", want: true},
		{name: "and --insecure is how you say otherwise", addr: "0.0.0.0:7777", insecure: true},
		{name: "a given token is used", explicit: "given", addr: "0.0.0.0:7777", want: true},
		{name: "the environment is next", env: "from-env", addr: "203.0.113.7:7777", want: true},
		{name: "the flag beats the environment", explicit: "given", env: "from-env", addr: "203.0.113.7:7777", want: true},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			token, err := ResolveToken(test.explicit, test.env, dir, test.addr, test.insecure)
			if err != nil {
				t.Fatal(err)
			}
			if (token != "") != test.want {
				t.Fatalf("token = %q, wanted one: %v", token, test.want)
			}
			if test.explicit != "" && token != test.explicit {
				t.Errorf("the flag should win, got %q", token)
			}
			if test.explicit == "" && test.env != "" && token != test.env {
				t.Errorf("the environment should be used, got %q", token)
			}

			// A generated token is stored so it survives a restart, privately.
			if token != "" && test.explicit == "" && test.env == "" {
				path := filepath.Join(dir, "token")
				stored, err := os.ReadFile(path)
				if err != nil {
					t.Fatalf("a generated token should be written to %s: %v", path, err)
				}
				if strings.TrimSpace(string(stored)) != token {
					t.Errorf("the stored token should be the one in use, got %q", stored)
				}
				info, err := os.Stat(path)
				if err != nil {
					t.Fatal(err)
				}
				if mode := info.Mode().Perm(); mode != 0o600 {
					t.Errorf("the token file should be private, got %o", mode)
				}
			}
		})
	}
}

func TestResolveTokenReusesWhatItStored(t *testing.T) {
	dir := t.TempDir()
	first, err := ResolveToken("", "", dir, "0.0.0.0:7777", false)
	if err != nil {
		t.Fatal(err)
	}
	second, err := ResolveToken("", "", dir, "0.0.0.0:7777", false)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Errorf("a restart should not invalidate every open link: %q then %q", first, second)
	}
}

// RequireToken accepts what a browser and a script can each actually send, and refuses
// everything else.
func TestRequireToken(t *testing.T) {
	const token = "s3cret"
	recorder := func() *httptest.ResponseRecorder { return httptest.NewRecorder() }
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("body"))
	})
	handler := RequireToken(ok, token)

	t.Run("no credentials is a refusal", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodGet, "/api/state", nil)
		response := recorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Errorf("expected 401, got %d", response.Code)
		}
	})

	t.Run("a bearer token is accepted", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodGet, "/api/state", nil)
		request.Header.Set(tokenHeader, "Bearer "+token)
		response := recorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", response.Code)
		}
	})

	t.Run("a wrong token is refused", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodGet, "/api/state", nil)
		request.Header.Set(tokenHeader, "Bearer s3cre")
		response := recorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Errorf("expected 401, got %d", response.Code)
		}
	})

	// EventSource cannot set headers, which is why the query parameter exists — and why it
	// sets a cookie and redirects rather than staying in the address bar.
	t.Run("a query token sets a cookie and redirects", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodGet, "/?token="+token, nil)
		response := recorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusSeeOther && response.Code != http.StatusFound {
			t.Fatalf("expected a redirect, got %d", response.Code)
		}
		if location := response.Header().Get("Location"); location != "/" {
			t.Errorf("expected a redirect to /, got %q", location)
		}
		cookies := response.Result().Cookies()
		if len(cookies) != 1 || cookies[0].Name != tokenCookie || cookies[0].Value != token {
			t.Fatalf("expected the token cookie to be set, got %+v", cookies)
		}
		if !cookies[0].HttpOnly {
			t.Error("the token cookie should not be readable from a script")
		}

		// And the cookie alone is enough for the next request.
		next := httptest.NewRequest(http.MethodGet, "/api/state", nil)
		next.AddCookie(cookies[0])
		nextResponse := recorder()
		handler.ServeHTTP(nextResponse, next)
		if nextResponse.Code != http.StatusOK {
			t.Errorf("the cookie should authenticate, got %d", nextResponse.Code)
		}
		if nextResponse.Body.String() != "body" {
			t.Errorf("the request should reach the handler, got %q", nextResponse.Body.String())
		}
	})

	t.Run("a wrong query token is refused and sets nothing", func(t *testing.T) {
		request := httptest.NewRequest(http.MethodGet, "/?token=nope", nil)
		response := recorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Errorf("expected 401, got %d", response.Code)
		}
		if len(response.Result().Cookies()) != 0 {
			t.Error("a wrong token must not set a cookie")
		}
	})

	t.Run("with no token configured everything passes", func(t *testing.T) {
		open := RequireToken(ok, "")
		request := httptest.NewRequest(http.MethodGet, "/api/state", nil)
		response := recorder()
		open.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", response.Code)
		}
	})
}
