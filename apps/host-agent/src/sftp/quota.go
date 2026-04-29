package sftp

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/nasbb/host-agent/src/allocation"
	"github.com/nasbb/host-agent/src/events"
)

type AllocationManager interface {
	List() ([]*allocation.Allocation, error)
	Save(alloc *allocation.Allocation) error
}

type QuotaPoller struct {
	manager  AllocationManager
	sftp     *Manager
	reposDir string
	evts     *events.Logger
	interval time.Duration
}

func NewQuotaPoller(m AllocationManager, s *Manager, reposDir string, evts *events.Logger) *QuotaPoller {
	return &QuotaPoller{
		manager:  m,
		sftp:     s,
		reposDir: reposDir,
		evts:     evts,
		interval: 60 * time.Second,
	}
}

func (p *QuotaPoller) Start(ctx context.Context) {
	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			p.pollAll(ctx)
		}
	}
}

func (p *QuotaPoller) pollAll(ctx context.Context) {
	allocs, err := p.manager.List()
	if err != nil {
		return
	}
	for _, alloc := range allocs {
		if alloc.State != "READY" && alloc.State != "SUSPENDED" {
			continue
		}
		p.PollOne(ctx, alloc)
	}
}

func (p *QuotaPoller) PollOne(ctx context.Context, alloc *allocation.Allocation) error {
	out, err := exec.CommandContext(ctx, "du", "-sb", alloc.RepoPath).Output()
	if err != nil {
		return err
	}
	parts := strings.Fields(string(out))
	if len(parts) == 0 {
		return fmt.Errorf("unexpected du output")
	}
	used, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return err
	}

	alloc.UsedBytes = used
	alloc.LastQuotaCheckAt = time.Now().UTC().Format(time.RFC3339)

	prevState := alloc.QuotaState
	criticalThreshold := float64(alloc.QuotaBytes) * (1 - float64(alloc.CriticalThresholdPercent)/100)
	warningThreshold := float64(alloc.QuotaBytes) * (1 - float64(alloc.WarningThresholdPercent)/100)

	if float64(used) >= criticalThreshold {
		alloc.QuotaState = "critical"
		if alloc.State == "READY" {
			p.sftp.DeauthorizeKey(alloc.Username)
			alloc.QuotaEnforcedSuspend = true
			alloc.SuspendedAt = time.Now().UTC().Format(time.RFC3339)
			alloc.State = "SUSPENDED"
			p.evts.Append("quota.critical", alloc.AllocID, "quota critical: SFTP access suspended")
		}
	} else if float64(used) >= warningThreshold {
		alloc.QuotaState = "warning"
		if prevState != "warning" && prevState != "critical" {
			p.evts.Append("quota.warning", alloc.AllocID, "quota warning threshold reached")
		}
	} else {
		alloc.QuotaState = "ok"
		if prevState == "warning" || prevState == "critical" {
			p.evts.Append("quota.restored", alloc.AllocID, "quota usage restored to ok")
			if prevState == "critical" && alloc.QuotaEnforcedSuspend {
				p.sftp.AuthorizeKey(alloc, alloc.OwnerPublicKey)
				alloc.QuotaEnforcedSuspend = false
				alloc.SuspendedAt = ""
				alloc.State = "READY"
			}
		}
	}

	return p.manager.Save(alloc)
}
