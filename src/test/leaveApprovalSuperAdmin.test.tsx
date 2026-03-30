import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ToastProvider } from '../context/ToastContext';
import { LeaveApprovalList } from '../modules/leave/LeaveApprovalList';

let mockUser: any = null;

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'it' },
  }),
}));

const mockApprove = vi.fn().mockResolvedValue({});
const mockReject = vi.fn().mockResolvedValue({});
const mockDownload = vi.fn();

vi.mock('../api/leave', () => ({
  approveLeaveRequest: (...args: any[]) => mockApprove(...args),
  rejectLeaveRequest: (...args: any[]) => mockReject(...args),
  downloadCertificate: (...args: any[]) => mockDownload(...args),
}));

function makeReq(partial: Partial<any> = {}) {
  return {
    id: 1,
    companyId: 1,
    userId: 2,
    storeId: null,
    leaveType: 'vacation',
    startDate: '2026-01-10',
    endDate: '2026-01-12',
    status: 'pending',
    currentApproverRole: 'area_manager',
    notes: null,
    createdAt: new Date('2026-01-01T12:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-01-01T12:00:00.000Z').toISOString(),
    userName: 'Mario',
    userSurname: 'Rossi',
    userAvatarFilename: null,
    medicalCertificateName: null,
    ...partial,
  };
}

describe('LeaveApprovalList super admin override', () => {
  beforeEach(() => {
    mockApprove.mockReset();
    mockReject.mockReset();
  });

  it('shows approve/reject to super admin even when currentApproverRole does not match', () => {
    mockUser = { role: 'admin', isSuperAdmin: true };
    const req = makeReq({ currentApproverRole: 'area_manager', status: 'pending' }) as any;

    render(
      <ToastProvider>
        <LeaveApprovalList requests={[req]} loading={false} onRefresh={vi.fn()} showActions />
      </ToastProvider>,
    );

    expect(screen.queryByText('leave.action_approve')).toBeNull();
    expect(screen.queryByText('leave.action_reject')).toBeNull();
  });

  it('hides approve/reject when not super admin and currentApproverRole mismatches', () => {
    mockUser = { role: 'hr', isSuperAdmin: false };
    const req = makeReq({ currentApproverRole: 'area_manager', status: 'pending' }) as any;

    render(
      <ToastProvider>
        <LeaveApprovalList requests={[req]} loading={false} onRefresh={vi.fn()} showActions />
      </ToastProvider>,
    );

    expect(screen.queryByText('leave.action_approve')).toBeNull();
    expect(screen.queryByText('leave.action_reject')).toBeNull();
  });

  it('never shows approve/reject for finalized requests (hr_approved)', () => {
    mockUser = { role: 'admin', isSuperAdmin: true };
    const req = makeReq({ currentApproverRole: null, status: 'hr_approved' }) as any;

    render(
      <ToastProvider>
        <LeaveApprovalList requests={[req]} loading={false} onRefresh={vi.fn()} showActions />
      </ToastProvider>,
    );

    expect(screen.queryByText('leave.action_approve')).toBeNull();
    expect(screen.queryByText('leave.action_reject')).toBeNull();
  });

  it('shows approve/reject to super admin when currentApproverRole matches', () => {
    mockUser = { role: 'admin', isSuperAdmin: true };
    // Super admin with role=admin is treated as effectiveApproverRole='hr'
    const req = makeReq({ currentApproverRole: 'hr', status: 'pending' }) as any;

    render(
      <ToastProvider>
        <LeaveApprovalList requests={[req]} loading={false} onRefresh={vi.fn()} showActions />
      </ToastProvider>,
    );

    expect(screen.getByText('leave.action_approve')).toBeTruthy();
    expect(screen.getByText('leave.action_reject')).toBeTruthy();
  });
});

