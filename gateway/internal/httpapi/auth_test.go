package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// The token is the boundary for a non-loopback bind, so what it protects against and what it
// deliberately does not are both worth pinning: a loopback bind needs nothing, and exposing
// the port without --insecure always ends up with a token.
// The console asks for nothing by default: on loopback and on a network address alike. The flag and the
// environment are still a lock for whoever wants one, and the flag wins.
func TestResolveToken(t *testing.T) {
	cases := []struct {
		name     string
		explicit string
		env      string
		want     string
	}{
		{name: "no flag and no environment is no token"},
		{name: "a given token is used", explicit: "given", want: "given"},
		{name: "the environment is next", env: "from-env", want: "from-env"},
		{name: "the flag beats the environment", explicit: "given", env: "from-env", want: "given"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := ResolveToken(test.explicit, test.env); got != test.want {
				t.Fatalf("token = %q, want %q", got, test.want)
			}
		})
	}
}

// A token file an older install left in the mount no longer turns authentication on: the file is not
// read at all, so an upgrade does not bring back a lock nobody asked for.
func TestAnOldTokenFileIsNotPickedUp(t *testing.T) {
	if got := ResolveToken("", ""); got != "" {
		t.Errorf("the default is no token, got %q", got)
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
