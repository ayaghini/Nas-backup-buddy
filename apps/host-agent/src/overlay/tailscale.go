package overlay

import (
	"net"
	"strings"
)

type Status struct {
	Provider              string
	Mode                  string
	Available             bool
	HostAddress           string
	SFTPExpectedHost      string
	SFTPPort              int
	// PublicPort is the port embedded in invite bundles. Equals SFTPPort unless
	// Tailscale Funnel is active, in which case it is the Funnel public port (e.g. 443).
	PublicPort            int
	PublicExposureWarning bool
}

func GetStatus(tailscaleAddr, sftpBind string, sftpPort, publicPort int) Status {
	if publicPort == 0 {
		publicPort = sftpPort
	}
	warning := isPublicExposure(sftpBind) && tailscaleAddr == ""

	if tailscaleAddr != "" {
		return Status{
			Provider:              "tailscale",
			Mode:                  "env-configured",
			Available:             true,
			HostAddress:           tailscaleAddr,
			SFTPExpectedHost:      tailscaleAddr,
			SFTPPort:              sftpPort,
			PublicPort:            publicPort,
			PublicExposureWarning: warning,
		}
	}
	return Status{
		Provider:              "tailscale",
		Mode:                  "unconfigured",
		Available:             false,
		HostAddress:           "",
		SFTPExpectedHost:      "",
		SFTPPort:              sftpPort,
		PublicPort:            publicPort,
		PublicExposureWarning: warning,
	}
}

func isPublicExposure(bind string) bool {
	if bind == "127.0.0.1" || bind == "::1" {
		return false
	}
	if strings.HasPrefix(bind, "100.") {
		return false
	}
	ip := net.ParseIP(bind)
	if ip != nil && ip.IsLoopback() {
		return false
	}
	return true
}
