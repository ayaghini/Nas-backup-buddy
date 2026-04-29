package bundle

import (
	"time"

	"github.com/nasbb/host-agent/src/allocation"
	"github.com/nasbb/host-agent/src/config"
	"github.com/nasbb/host-agent/src/overlay"
)

type HostInviteBundle struct {
	BundleVersion    int              `json:"bundleVersion"`
	Kind             string           `json:"kind"`
	HostAgentVersion string           `json:"hostAgentVersion"`
	MatchID          string           `json:"matchId"`
	AllocID          string           `json:"allocId"`
	ConnectionName   string           `json:"connectionName"`
	Overlay          inviteOverlay    `json:"overlay"`
	SFTP             inviteSFTP       `json:"sftp"`
	Quota            inviteQuota      `json:"quota"`
	HostKey          inviteHostKey    `json:"hostKey"`
	ExpiresAt        string           `json:"expiresAt"`
}

type inviteOverlay struct {
	Provider string `json:"provider"`
	Host     string `json:"host"`
	Note     string `json:"note"`
}

type inviteSFTP struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Path     string `json:"path"`
}

type inviteQuota struct {
	QuotaBytes int64  `json:"quotaBytes"`
	QuotaMode  string `json:"quotaMode"`
}

type inviteHostKey struct {
	FingerprintSHA256 string `json:"fingerprintSha256"`
	VerificationNote  string `json:"verificationNote"`
}

func Generate(alloc *allocation.Allocation, cfg *config.Config, ov overlay.Status, fingerprint string) HostInviteBundle {
	expiresAt := time.Now().UTC().AddDate(0, 0, 90).Format(time.RFC3339)

	overlayNote := "Host SFTP is reachable at this Tailscale address."
	if !ov.Available {
		overlayNote = "SFTP host address not configured. Set TAILSCALE_ADDRESS before generating invites."
	}

	return HostInviteBundle{
		BundleVersion:    1,
		Kind:             "nasbb.host_invite",
		HostAgentVersion: "0.1.0",
		MatchID:          alloc.MatchID,
		AllocID:          alloc.AllocID,
		ConnectionName:   alloc.ConnectionName,
		Overlay: inviteOverlay{
			Provider: "tailscale",
			Host:     ov.HostAddress,
			Note:     overlayNote,
		},
		SFTP: inviteSFTP{
			Host:     ov.HostAddress,
			Port:     ov.SFTPPort,
			Username: alloc.Username,
			Path:     "/repository",
		},
		Quota: inviteQuota{
			QuotaBytes: alloc.QuotaBytes,
			QuotaMode:  alloc.QuotaMode,
		},
		HostKey: inviteHostKey{
			FingerprintSHA256: fingerprint,
			VerificationNote:  "Verify out-of-band before trusting the first connection.",
		},
		ExpiresAt: expiresAt,
	}
}
