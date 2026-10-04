package control

import "testing"

// A level is only meaningful relative to a model, and models declare scales that
// are neither complete nor uniform: minimax-m3 offers off through high, some
// models offer only off and high, and a non-reasoning model offers only off.
// Every branch below is a case that produced a wrong answer at some point.
func TestResolveThinking(t *testing.T) {
	full := []string{"off", "minimal", "low", "medium", "high", "xhigh", "max"}
	gapped := []string{"off", "high"}
	capped := []string{"off", "minimal", "low", "medium", "high"}
	onlyOff := []string{"off"}
	onlyHigh := []string{"high"}

	cases := []struct {
		name      string
		levels    []string
		preferred []string
		want      string
	}{
		{"no preference expressed", full, []string{"", "", ""}, ""},
		{"no preference at all", onlyOff, nil, ""},
		{"the first preference the model supports wins", full, []string{"high"}, "high"},
		{"an unsupported choice falls back to the default", gapped, []string{"max", "high"}, "high"},
		// A preference the model cannot express is skipped rather than approximated,
		// so a supported lower-specificity layer wins over an unsupported higher one.
		// This is the one place specificity loses, and the alternative is in the ADR.
		{"an unsupported definition falls back to the default", gapped, []string{"", "minimal", "high"}, "high"},
		{"a supported definition beats the default", full, []string{"", "minimal", "high"}, "minimal"},
		{"an unsupported choice clamps down when no layer is supported", capped, []string{"xhigh"}, "high"},
		// "Fall back to the default" means the default gets a chance before
		// clamping: an unsupported choice prefers a supported default over the
		// nearest level below itself.
		{"an unsupported choice falls back to a supported default", capped, []string{"max", "", "off"}, "off"},
		{"an unsupported choice clamps when the default is unsupported too", capped, []string{"xhigh", "", "max"}, "high"},
		{"a supported choice ignores the default", capped, []string{"low", "", "off"}, "low"},
		{"a gap clamps to the level below it", gapped, []string{"medium"}, "off"},
		{"nothing below falls to the lowest level", onlyHigh, []string{"off"}, "high"},
		{"a non-reasoning model can only be off", onlyOff, []string{"max"}, "off"},
		{"every preference unsupported clamps the most specific", full, []string{"max", "xhigh", "xhigh"}, "max"},
		{"empty levels leave an explicit choice alone", nil, []string{"medium"}, "medium"},
		{"empty levels leave an inherited default alone", nil, []string{"", "high"}, "high"},
		{"the scale orders levels, not the provider's listing", []string{"high", "off", "low"}, []string{"medium"}, "low"},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := resolveThinking(test.levels, test.preferred...); got != test.want {
				t.Errorf("resolveThinking(%v, %v) = %q, want %q", test.levels, test.preferred, got, test.want)
			}
		})
	}
}

func TestLowestThinking(t *testing.T) {
	cases := []struct {
		levels []string
		want   string
	}{
		{[]string{"off", "high"}, "off"},
		{[]string{"high", "off"}, "off"},
		{[]string{"high", "medium"}, "medium"},
		{[]string{"high"}, "high"},
		{nil, ""},
	}
	for _, test := range cases {
		if got := lowestThinking(test.levels); got != test.want {
			t.Errorf("lowestThinking(%v) = %q, want %q", test.levels, got, test.want)
		}
	}
}
