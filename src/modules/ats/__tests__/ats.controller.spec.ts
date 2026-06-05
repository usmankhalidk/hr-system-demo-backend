import { Request, Response } from 'express';
import { jobFeedHandler } from '../ats.controller';
import { getPublishedJobsForFeed } from '../ats.service';

jest.mock('../ats.service', () => {
  const original = jest.requireActual('../ats.service');
  return {
    ...original,
    getPublishedJobsForFeed: jest.fn(),
  };
});

const mockGetPublishedJobsForFeed = getPublishedJobsForFeed as jest.Mock;

describe('jobFeedHandler — Indeed feed compliance', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let sendMock: jest.Mock;
  let statusMock: jest.Mock;
  let typeMock: jest.Mock;
  let setHeaderMock: jest.Mock;

  beforeEach(() => {
    sendMock = jest.fn();
    statusMock = jest.fn().mockReturnThis();
    typeMock = jest.fn().mockReturnThis();
    setHeaderMock = jest.fn();

    req = {
      params: { slug: 'paradise-limited' },
      protocol: 'http',
      get: jest.fn().mockImplementation((header) => {
        if (header === 'host') return 'localhost:3001';
        return '';
      }),
    };

    res = {
      status: statusMock,
      type: typeMock,
      send: sendMock,
      setHeader: setHeaderMock,
    };

    jest.clearAllMocks();
  });

  const mockCompany = {
    id: 3,
    name: 'Paradise Limited',
    slug: 'paradise-limited',
    city: 'Milan',
    state: 'MI',
    country: 'IT',
    address: 'Via Torino 12',
    companyEmail: 'recruitment@paradise.it',
  };

  const createMockJob = (overrides: any = {}) => ({
    id: 8,
    companyId: 3,
    companySlug: 'paradise-limited',
    companyName: 'Paradise Limited',
    companyGroupName: 'Paradise Group',
    companyEmail: 'recruitment@paradise.it',
    title: 'Cashier',
    description: 'Manage cash and make daily, weekly sales reports against each store',
    tags: ['Cashier', 'Manager', 'Italy'],
    language: 'en',
    jobType: 'fulltime',
    status: 'published',
    source: 'Indeed',
    indeedPostId: 'indeed-123',
    referenceId: 'VY-PA-0002',
    publishedAt: '2026-04-14T07:20:39.259Z',
    createdAt: '2026-04-14T07:20:39.259Z',
    remoteType: 'hybrid',
    city: 'Milan',
    state: 'MI',
    country: 'IT',
    postalCode: '20121',
    address: 'Via Torino 12',
    salaryMin: 1800,
    salaryMax: 2400,
    salaryPeriod: 'monthly',
    ...overrides,
  });

  it('Test 1 — <requisitionid> is present in every job', async () => {
    const job1 = createMockJob({ id: 101 });
    const job2 = createMockJob({ id: 102 });
    mockGetPublishedJobsForFeed.mockResolvedValue({
      company: mockCompany,
      jobs: [job1, job2],
    });

    await jobFeedHandler(req as Request, res as Response);

    expect(sendMock).toHaveBeenCalled();
    const xml = sendMock.mock.calls[0][0];

    expect(xml).toContain('<requisitionid>REQ-101</requisitionid>');
    expect(xml).toContain('<requisitionid>REQ-102</requisitionid>');
  });

  it('Test 2 — <date> format is ISO 8601', async () => {
    const job = createMockJob({ publishedAt: '2026-06-04T12:00:00.000Z' });
    mockGetPublishedJobsForFeed.mockResolvedValue({
      company: mockCompany,
      jobs: [job],
    });

    await jobFeedHandler(req as Request, res as Response);

    const xml = sendMock.mock.calls[0][0];
    const dateMatch = xml.match(/<date><!\[CDATA\[(.*?)\]\]><\/date>/);
    expect(dateMatch).toBeTruthy();
    const dateValue = dateMatch[1];

    expect(dateValue).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(dateValue).not.toContain('Fri');
    expect(dateValue).not.toContain('Jun');
  });

  it('Test 3 — Job URL contains ?source=Indeed', async () => {
    const job = createMockJob({ id: 99 });
    mockGetPublishedJobsForFeed.mockResolvedValue({
      company: mockCompany,
      jobs: [job],
    });

    await jobFeedHandler(req as Request, res as Response);

    const xml = sendMock.mock.calls[0][0];
    expect(xml).toContain('source=Indeed');
  });

  it('Test 4 — <remotetype> valid values only', async () => {
    // 1. Fully remote
    const jobRemote = createMockJob({ remoteType: 'remote' });
    mockGetPublishedJobsForFeed.mockResolvedValue({
      company: mockCompany,
      jobs: [jobRemote],
    });
    await jobFeedHandler(req as Request, res as Response);
    let xml = sendMock.mock.calls[0][0];
    expect(xml).toContain('<remotetype><![CDATA[Fully remote]]></remotetype>');

    // 2. Hybrid remote
    jest.clearAllMocks();
    const jobHybrid = createMockJob({ remoteType: 'hybrid' });
    mockGetPublishedJobsForFeed.mockResolvedValue({
      company: mockCompany,
      jobs: [jobHybrid],
    });
    await jobFeedHandler(req as Request, res as Response);
    xml = sendMock.mock.calls[0][0];
    expect(xml).toContain('<remotetype><![CDATA[Hybrid remote]]></remotetype>');

    // 3. On-site
    jest.clearAllMocks();
    const jobOnsite = createMockJob({ remoteType: 'onsite' });
    mockGetPublishedJobsForFeed.mockResolvedValue({
      company: mockCompany,
      jobs: [jobOnsite],
    });
    await jobFeedHandler(req as Request, res as Response);
    xml = sendMock.mock.calls[0][0];
    expect(xml).not.toContain('<remotetype>');
  });

  it('Test 5 — <remotetype> does not emit "fullremote"', async () => {
    const job = createMockJob({ remoteType: 'remote' });
    mockGetPublishedJobsForFeed.mockResolvedValue({
      company: mockCompany,
      jobs: [job],
    });

    await jobFeedHandler(req as Request, res as Response);

    const xml = sendMock.mock.calls[0][0];
    expect(xml).not.toContain('fullremote');
  });

  it('Test 6 — Job with missing city appears in feed (no silent drop)', async () => {
    const job = createMockJob({ city: null, remoteType: 'onsite' });
    mockGetPublishedJobsForFeed.mockResolvedValue({
      company: mockCompany,
      jobs: [job],
    });

    await jobFeedHandler(req as Request, res as Response);

    const xml = sendMock.mock.calls[0][0];
    expect(xml).toContain('<job>');
    expect(xml).toContain('<city><![CDATA[Remote]]></city>');
  });

  it('Test 7 — <sourcename> is present (TECH-1B fix)', async () => {
    const job = createMockJob({ companyGroupName: 'Test Group' });
    mockGetPublishedJobsForFeed.mockResolvedValue({
      company: mockCompany,
      jobs: [job],
    });

    await jobFeedHandler(req as Request, res as Response);

    const xml = sendMock.mock.calls[0][0];
    expect(xml).toContain('<sourcename><![CDATA[Test Group]]></sourcename>');
  });

  it('Test 8 — <email> is present (TECH-1B fix)', async () => {
    const job = createMockJob({ companyEmail: 'hr@example.com' });
    mockGetPublishedJobsForFeed.mockResolvedValue({
      company: mockCompany,
      jobs: [job],
    });

    await jobFeedHandler(req as Request, res as Response);

    const xml = sendMock.mock.calls[0][0];
    expect(xml).toContain('<email><![CDATA[hr@example.com]]></email>');
  });

  it('Test 9 — <state> is not numeric (TECH-1B fix)', async () => {
    // State 25 -> MI
    const jobMilano = createMockJob({ state: '25', city: 'Milan', remoteType: 'onsite' });
    mockGetPublishedJobsForFeed.mockResolvedValue({
      company: mockCompany,
      jobs: [jobMilano],
    });
    await jobFeedHandler(req as Request, res as Response);
    let xml = sendMock.mock.calls[0][0];
    expect(xml).toContain('<state><![CDATA[MI]]></state>');
    expect(xml).not.toContain('<state><![CDATA[25]]></state>');

    // State 72 -> SA
    jest.clearAllMocks();
    const jobSalerno = createMockJob({ state: '72', city: 'Salerno', remoteType: 'onsite' });
    mockGetPublishedJobsForFeed.mockResolvedValue({
      company: mockCompany,
      jobs: [jobSalerno],
    });
    await jobFeedHandler(req as Request, res as Response);
    xml = sendMock.mock.calls[0][0];
    expect(xml).toContain('<state><![CDATA[SA]]></state>');
    expect(xml).not.toContain('<state><![CDATA[72]]></state>');

    // Assert matches letter pattern
    const stateMatch = xml.match(/<state><!\[CDATA\[(.*?)\]\]><\/state>/);
    expect(stateMatch).toBeTruthy();
    expect(stateMatch[1]).toMatch(/^[A-Za-z]/);
  });
});
