package api

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/nasbb/host-agent/src/allocation"
)

// PeerServer is a minimal HTTP server reachable from a peer over Tailscale.
// It exposes one unauthenticated route that accepts an owner-access response
// directly from the peer app, validated using a one-time invite token.
type PeerServer struct {
	manager *allocation.Manager
	sftpMgr interface {
		AuthorizeKey(alloc *allocation.Allocation, pubKey string) error
	}
	events interface {
		Append(kind, allocID, message string) error
	}
}

// submitResponseBody is the JSON body the peer POSTs to /peer/v1/submit-response.
type submitResponseBody struct {
	InviteToken           string `json:"inviteToken"`
	MatchID               string `json:"matchId"`
	AllocID               string `json:"allocId"`
	OwnerPublicKey        string `json:"ownerPublicKey"`
	RequestedSFTPUsername string `json:"requestedSftpUsername"`
	OwnerDeviceLabel      string `json:"ownerDeviceLabel"`
	CreatedAt             string `json:"createdAt"`
}

// NewPeerServer creates a new PeerServer.
func NewPeerServer(s *Server) *PeerServer {
	return &PeerServer{
		manager: s.manager,
		sftpMgr: s.sftpMgr,
		events:  s.events,
	}
}

// PeerRouter returns an http.Handler for the peer-facing API.
func (p *PeerServer) PeerRouter() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/peer/v1/submit-response", p.handleSubmitResponse)
	return mux
}

func (p *PeerServer) handleSubmitResponse(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writePeerError(w, http.StatusMethodNotAllowed, "method not allowed", "METHOD_NOT_ALLOWED")
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
	if err != nil {
		writePeerError(w, http.StatusBadRequest, "failed to read body", "BAD_REQUEST")
		return
	}

	var req submitResponseBody
	if err := json.Unmarshal(body, &req); err != nil {
		writePeerError(w, http.StatusBadRequest, "invalid JSON", "INVALID_JSON")
		return
	}

	if req.AllocID == "" || req.InviteToken == "" {
		writePeerError(w, http.StatusBadRequest, "allocId and inviteToken are required", "MISSING_FIELDS")
		return
	}

	alloc, err := p.manager.Get(req.AllocID)
	if err != nil {
		// Return generic error to avoid leaking alloc IDs via timing
		writePeerError(w, http.StatusUnauthorized, "invalid token or allocation", "UNAUTHORIZED")
		return
	}

	// Constant-time token comparison; also rejects empty stored token
	storedToken := alloc.InviteToken
	tokenMatch := len(storedToken) > 0 &&
		len(req.InviteToken) == len(storedToken) &&
		subtle.ConstantTimeCompare([]byte(req.InviteToken), []byte(storedToken)) == 1

	// Always invalidate the token regardless of whether auth succeeds, to prevent brute-force
	alloc.InviteToken = ""
	if saveErr := p.manager.Save(alloc); saveErr != nil {
		fmt.Printf("[peer-api] WARNING: failed to invalidate invite token for %s: %v\n", req.AllocID, saveErr)
	}

	if !tokenMatch {
		writePeerError(w, http.StatusUnauthorized, "invalid or already-used token", "UNAUTHORIZED")
		return
	}

	if alloc.State != "PENDING_KEY" {
		writePeerError(w, http.StatusConflict, "allocation not in PENDING_KEY state", "INVALID_STATE")
		return
	}

	if req.OwnerPublicKey == "" {
		writePeerError(w, http.StatusBadRequest, "ownerPublicKey is required", "MISSING_FIELDS")
		return
	}

	if err := p.sftpMgr.AuthorizeKey(alloc, req.OwnerPublicKey); err != nil {
		writePeerError(w, http.StatusBadRequest, err.Error(), "INVALID_KEY")
		return
	}

	alloc.OwnerPublicKey = req.OwnerPublicKey
	alloc.OwnerDeviceLabel = req.OwnerDeviceLabel
	alloc.OwnerKeyImportedAt = time.Now().UTC().Format(time.RFC3339)
	if err := p.manager.Transition(alloc, "READY"); err != nil {
		writePeerError(w, http.StatusInternalServerError, err.Error(), "INTERNAL")
		return
	}

	p.events.Append("key.authorized", req.AllocID, "owner key auto-submitted via peer API for "+alloc.ConnectionName)
	fmt.Printf("[peer-api] owner key authorized for alloc %s (%s)\n", req.AllocID, alloc.ConnectionName)

	writePeerJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func writePeerError(w http.ResponseWriter, status int, msg, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg, "code": code})
}

func writePeerJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
