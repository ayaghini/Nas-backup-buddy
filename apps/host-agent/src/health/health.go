package health

import (
	"net"
	"os"
	"syscall"
	"time"

	"github.com/nasbb/host-agent/src/allocation"
	"github.com/nasbb/host-agent/src/events"
	"github.com/nasbb/host-agent/src/overlay"
	"github.com/nasbb/host-agent/src/sftp"
)

type AllocHealth struct {
	AllocID               string `json:"allocId"`
	State                 string `json:"state"`
	QuotaMode             string `json:"quotaMode"`
	QuotaBytes            int64  `json:"quotaBytes"`
	UsedBytes             int64  `json:"usedBytes"`
	FreeBytes             int64  `json:"freeBytes"`
	WarningThresholdPercent int   `json:"warningThresholdPercent"`
	CriticalThresholdPercent int  `json:"criticalThresholdPercent"`
	QuotaState            string `json:"quotaState"`
	QuotaEnforcedSuspend  bool   `json:"quotaEnforcedSuspend"`
	SFTPAccessActive      bool   `json:"sftpAccessActive"`
	LastOwnerWriteAt      string `json:"lastOwnerWriteAt"`
}

type Report struct {
	AgentRunning              bool          `json:"agentRunning"`
	SFTPRunning               bool          `json:"sftpRunning"`
	SFTPBindAddress           string        `json:"sftpBindAddress"`
	SFTPPublicExposureWarning bool          `json:"sftpPublicExposureWarning"`
	OverlayStatus             string        `json:"overlayStatus"`
	StorageRootAvailable      bool          `json:"storageRootAvailable"`
	Allocations               []AllocHealth `json:"allocations"`
	RecentEvents              []events.EventRecord `json:"recentEvents"`
}

type AllocLister interface {
	List() ([]*allocation.Allocation, error)
}

func Get(mgr AllocLister, sftpMgr *sftp.Manager, ov overlay.Status,
	evtsLogger *events.Logger, reposDir, sftpHost string, sftpPort int) *Report {

	sftpRunning := false
	addr := net.JoinHostPort(sftpHost, string(rune('0'+sftpPort%10))) // fallback
	addr = sftpHost + ":" + intToStr(sftpPort)
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err == nil {
		conn.Close()
		sftpRunning = true
	}

	storageAvailable := false
	if _, err := os.Stat(reposDir); err == nil {
		storageAvailable = true
	}

	overlayStatusStr := "unconfigured"
	if ov.Available {
		overlayStatusStr = "connected"
	}

	allocs, _ := mgr.List()
	var allocHealths []AllocHealth
	for _, a := range allocs {
		free := a.QuotaBytes - a.UsedBytes
		if free < 0 {
			free = 0
		}
		allocHealths = append(allocHealths, AllocHealth{
			AllocID:                  a.AllocID,
			State:                    a.State,
			QuotaMode:                a.QuotaMode,
			QuotaBytes:               a.QuotaBytes,
			UsedBytes:                a.UsedBytes,
			FreeBytes:                free,
			WarningThresholdPercent:  a.WarningThresholdPercent,
			CriticalThresholdPercent: a.CriticalThresholdPercent,
			QuotaState:               a.QuotaState,
			QuotaEnforcedSuspend:     a.QuotaEnforcedSuspend,
			SFTPAccessActive:         a.State == "READY",
			LastOwnerWriteAt:         a.LastOwnerWriteAt,
		})
	}

	recentEvts, _ := evtsLogger.Query(10, time.Time{})
	if recentEvts == nil {
		recentEvts = []events.EventRecord{}
	}

	return &Report{
		AgentRunning:              true,
		SFTPRunning:               sftpRunning,
		SFTPBindAddress:           ov.SFTPExpectedHost,
		SFTPPublicExposureWarning: ov.PublicExposureWarning,
		OverlayStatus:             overlayStatusStr,
		StorageRootAvailable:      storageAvailable,
		Allocations:               allocHealths,
		RecentEvents:              recentEvts,
	}
}

func StorageStats(reposDir string) (total, avail int64) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(reposDir, &stat); err != nil {
		return 0, 0
	}
	total = int64(stat.Blocks) * stat.Bsize
	avail = int64(stat.Bavail) * stat.Bsize
	return
}

func intToStr(n int) string {
	if n == 0 {
		return "0"
	}
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	var buf [20]byte
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}
