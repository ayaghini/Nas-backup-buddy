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
	FingerprintSHA256     string   `json:"fingerprintSha256"`
	AlternateFingerprints []string `json:"alternateFingerprints,omitempty"`
	VerificationNote      string   `json:"verificationNote"`
}

// sftpHostForInvite returns the best available SFTP host for the invite bundle.
//
// Priority:
//  1. Tailscale/overlay address — reachable across the internet.
//  2. SFTP bind address — usable on the local network or for same-machine testing.
//     Skipped when bind is 0.0.0.0 (all-interfaces, not a routable address).
//  3. "127.0.0.1" — last resort for local-only testing.
func sftpHostForInvite(ov overlay.Status, sftpBind string) string {
	if ov.HostAddress != "" {
		return ov.HostAddress
	}
	if sftpBind != "" && sftpBind != "0.0.0.0" {
		return sftpBind
	}
	return "127.0.0.1"
}

func Generate(alloc *allocation.Allocation, cfg *config.Config, ov overlay.Status, fingerprint string, altFingerprints ...string) HostInviteBundle {
	expiresAt := time.Now().UTC().AddDate(0, 0, 90).Format(time.RFC3339)

	sftpHost := sftpHostForInvite(ov, cfg.SFTPBindAddress)

	overlayNote := "Host SFTP is reachable at this Tailscale address."
	if !ov.Available {
		overlayNote = "Tailscale not configured. Using local/bind address — only reachable on the same machine or local network."
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
			Host:     sftpHost,
			Note:     overlayNote,
		},
		SFTP: inviteSFTP{
			Host:     sftpHost,
			Port:     ov.SFTPPort,
			Username: alloc.Username,
			Path:     "/repository",
		},
		Quota: inviteQuota{
			QuotaBytes: alloc.QuotaBytes,
			QuotaMode:  alloc.QuotaMode,
		},
		HostKey: inviteHostKey{
			FingerprintSHA256:     fingerprint,
			AlternateFingerprints: altFingerprints,
			VerificationNote:      "Verify out-of-band before trusting the first connection.",
		},
		ExpiresAt: expiresAt,
	}
}
