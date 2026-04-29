package api

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"
)

func BearerAuth(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("Authorization")
			parts := strings.SplitN(auth, " ", 2)
			if len(parts) != 2 || parts[0] != "Bearer" {
				writeError(w, http.StatusUnauthorized, "unauthorized", "UNAUTHORIZED")
				return
			}
			given := []byte(parts[1])
			expected := []byte(token)
			if len(given) != len(expected) || subtle.ConstantTimeCompare(given, expected) != 1 {
				writeError(w, http.StatusUnauthorized, "unauthorized", "UNAUTHORIZED")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func writeError(w http.ResponseWriter, status int, msg, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg, "code": code})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
