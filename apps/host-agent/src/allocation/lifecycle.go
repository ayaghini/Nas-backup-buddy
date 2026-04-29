package allocation

import (
	"context"
	"fmt"
	"time"

	"github.com/nasbb/host-agent/src/events"
)

type SFTPManager interface {
	AuthorizeKey(alloc *Allocation, publicKey string) error
	DeauthorizeKey(username string) error
}

type QuotaPoller interface {
	PollOne(ctx context.Context, alloc *Allocation) error
}

type Lifecycle struct {
	manager     *Manager
	sftp        SFTPManager
	quotaPoller QuotaPoller
	log         *events.Logger
}

func NewLifecycle(m *Manager, s SFTPManager, q QuotaPoller, log *events.Logger) *Lifecycle {
	return &Lifecycle{manager: m, sftp: s, quotaPoller: q, log: log}
}

func (l *Lifecycle) Suspend(allocID string) (*Allocation, error) {
	alloc, err := l.manager.Get(allocID)
	if err != nil {
		return nil, err
	}
	if alloc.State != "READY" {
		return nil, fmt.Errorf("INVALID_STATE")
	}
	if err := l.sftp.DeauthorizeKey(alloc.Username); err != nil {
		return nil, err
	}
	if err := l.manager.Transition(alloc, "SUSPENDED"); err != nil {
		return nil, err
	}
	l.log.Append("allocation.suspended", allocID, "allocation suspended")
	return alloc, nil
}

func (l *Lifecycle) Resume(allocID string) (*Allocation, error) {
	alloc, err := l.manager.Get(allocID)
	if err != nil {
		return nil, err
	}
	if alloc.State != "SUSPENDED" {
		return nil, fmt.Errorf("INVALID_STATE")
	}
	if alloc.OwnerPublicKey == "" {
		return nil, fmt.Errorf("INVALID_STATE")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := l.quotaPoller.PollOne(ctx, alloc); err != nil {
		return nil, err
	}
	// Re-read after poll (state/quotaState may have changed)
	alloc, err = l.manager.Get(allocID)
	if err != nil {
		return nil, err
	}
	if alloc.QuotaState == "critical" {
		return nil, fmt.Errorf("QUOTA_STILL_CRITICAL")
	}

	if err := l.sftp.AuthorizeKey(alloc, alloc.OwnerPublicKey); err != nil {
		return nil, err
	}
	alloc.SuspendedAt = ""
	if err := l.manager.Transition(alloc, "READY"); err != nil {
		return nil, err
	}
	l.log.Append("allocation.resumed", allocID, "allocation resumed")
	return alloc, nil
}

func (l *Lifecycle) Retire(allocID string, graceDays int) (*Allocation, error) {
	alloc, err := l.manager.Get(allocID)
	if err != nil {
		return nil, err
	}
	if alloc.State == "RETIRING" || alloc.State == "RETIRED" {
		return nil, fmt.Errorf("INVALID_STATE")
	}
	if alloc.Username != "" {
		l.sftp.DeauthorizeKey(alloc.Username)
	}
	alloc.RetirementGraceDays = graceDays
	if err := l.manager.Transition(alloc, "RETIRING"); err != nil {
		return nil, err
	}
	l.log.Append("allocation.retiring", allocID, "allocation retirement initiated")
	return alloc, nil
}

func (l *Lifecycle) StartBackground(ctx context.Context) {
	go l.runExpiryChecker(ctx)
	go l.runRetirementChecker(ctx)
}

func (l *Lifecycle) runExpiryChecker(ctx context.Context) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			l.checkExpiry()
		}
	}
}

func (l *Lifecycle) runRetirementChecker(ctx context.Context) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			l.checkRetirement()
		}
	}
}

func (l *Lifecycle) checkExpiry() {
	allocs, err := l.manager.List()
	if err != nil {
		return
	}
	now := time.Now().UTC()
	for _, alloc := range allocs {
		if alloc.State != "PENDING_KEY" || alloc.InviteExpiresAt == "" {
			continue
		}
		exp, err := time.Parse(time.RFC3339, alloc.InviteExpiresAt)
		if err != nil || !now.After(exp) {
			continue
		}
		l.manager.Transition(alloc, "EXPIRED")
		l.log.Append("invite.expired", alloc.AllocID, "invite expired")
	}
}

func (l *Lifecycle) checkRetirement() {
	allocs, err := l.manager.List()
	if err != nil {
		return
	}
	now := time.Now().UTC()
	for _, alloc := range allocs {
		if alloc.State != "RETIRING" || alloc.RetirementInitiatedAt == "" {
			continue
		}
		initiated, err := time.Parse(time.RFC3339, alloc.RetirementInitiatedAt)
		if err != nil {
			continue
		}
		gracePeriod := time.Duration(alloc.RetirementGraceDays) * 24 * time.Hour
		if now.Before(initiated.Add(gracePeriod)) {
			continue
		}
		alloc.RetiredAt = now.Format(time.RFC3339)
		l.manager.Transition(alloc, "RETIRED")
		l.log.Append("allocation.retired", alloc.AllocID, "allocation retired after grace period")
	}
}
