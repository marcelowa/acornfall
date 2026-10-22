package httpapi

import (
	"crypto/subtle"
	"net"
	"net/http"
	"strings"
)

const (
	tokenCookie = "acornfall_token"
	tokenHeader = "Authorization"
)

// IsLoopback reports whether an address only accepts local connections.
func IsLoopback(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		host = addr
	}
	switch host {
	case "", "0.0.0.0", "::", "[::]":
		return false
	case "localhost":
		return true
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

// ResolveToken returns the shared secret guarding this listener, or "" when there is none — which is
// the default, on loopback and on a network address alike. MVP: the console asks for nothing, and a
// listener that is reachable from the network is reachable by whoever can route to it; the launcher
// says so once when it publishes one.
//
// `--token` (or ACORNFALL_TOKEN) still locks a listener, for anyone who wants that. Nothing is
// generated and nothing is read from disk: a token file an older install left behind no longer turns
// authentication on by surprise.
func ResolveToken(explicit, env string) string {
	if explicit != "" {
		return explicit
	}
	return env
}

// RequireToken guards a handler. A token may arrive as a bearer header, a
// cookie, or a ?token= query parameter; the query form sets the cookie and then
// redirects the page so the secret does not linger in the address bar. EventSource
// cannot set headers, which is why the cookie exists.
func RequireToken(next http.Handler, token string) http.Handler {
	if token == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		queryToken := r.URL.Query().Get("token")
		if !matches(r, queryToken, token) {
			w.Header().Set("WWW-Authenticate", `Bearer realm="acornfall"`)
			http.Error(w, "unauthorized: open the URL once with ?token=<token>", http.StatusUnauthorized)
			return
		}
		if queryToken != "" {
			http.SetCookie(w, &http.Cookie{
				Name:     tokenCookie,
				Value:    token,
				Path:     "/",
				HttpOnly: true,
				SameSite: http.SameSiteLaxMode,
				MaxAge:   365 * 24 * 60 * 60,
			})
			if r.URL.Path == "/" {
				http.Redirect(w, r, "/", http.StatusFound)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func matches(r *http.Request, queryToken, token string) bool {
	candidates := []string{queryToken}
	if header := r.Header.Get(tokenHeader); header != "" {
		candidates = append(candidates, strings.TrimSpace(strings.TrimPrefix(header, "Bearer ")))
	}
	if cookie, err := r.Cookie(tokenCookie); err == nil {
		candidates = append(candidates, cookie.Value)
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(candidate), []byte(token)) == 1 {
			return true
		}
	}
	return false
}
