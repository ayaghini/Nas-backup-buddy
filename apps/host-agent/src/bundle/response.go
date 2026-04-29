package bundle

import (
	"encoding/json"
	"time"

	gossh "golang.org/x/crypto/ssh"

	"github.com/nasbb/host-agent/src/allocation"
)

type OwnerAccessResponse struct {
	BundleVersion         int    `json:"bundleVersion"`
	Kind                  string `json:"kind"`
	MatchID               string `json:"matchId"`
	AllocID               string `json:"allocId"`
	OwnerDeviceLabel      string `json:"ownerDeviceLabel"`
	OwnerPublicKey        string `json:"ownerPublicKey"`
	RequestedSFTPUsername string `json:"requestedSftpUsername"`
	CreatedAt             string `json:"createdAt"`
}

type ParseError struct {
	Code    string
	Message string
}

func (e *ParseError) Error() string { return e.Message }

func Parse(data []byte, alloc *allocation.Allocation) (*OwnerAccessResponse, error) {
	var resp OwnerAccessResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, &ParseError{Code: "INVALID_KEY", Message: "invalid request body"}
	}

	if resp.Kind != "nasbb.owner_access_response" {
		return nil, &ParseError{Code: "INVALID_KEY", Message: "unexpected bundle kind"}
	}

	if resp.AllocID != alloc.AllocID {
		return nil, &ParseError{Code: "ALLOC_ID_MISMATCH", Message: "allocId does not match"}
	}

	if resp.MatchID != alloc.MatchID {
		return nil, &ParseError{Code: "MATCH_ID_MISMATCH", Message: "matchId does not match"}
	}

	if _, _, _, _, err := gossh.ParseAuthorizedKey([]byte(resp.OwnerPublicKey)); err != nil {
		return nil, &ParseError{Code: "INVALID_KEY", Message: "invalid SSH public key"}
	}

	if alloc.InviteExpiresAt != "" {
		exp, err := time.Parse(time.RFC3339, alloc.InviteExpiresAt)
		if err == nil && time.Now().UTC().After(exp) {
			return nil, &ParseError{Code: "INVITE_EXPIRED", Message: "invite has expired"}
		}
	}

	return &resp, nil
}
