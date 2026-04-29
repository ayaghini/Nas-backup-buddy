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
	PublicExposureWarning bool
}

func GetStatus(tailscaleAddr, sftpBind string, sftpPort int) Status {
	warning := isPublicExposure(sftpBind) && tailscaleAddr == ""

	if tailscaleAddr != "" {
		return Status{
			Provider:              "tailscale",
			Mode:                  "env-configured",
			Available:             true,
			HostAddress:           tailscaleAddr,
			SFTPExpectedHost:      tailscaleAddr,
			SFTPPort:              sftpPort,
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
