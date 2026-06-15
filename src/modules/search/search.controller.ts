import { Request, Response } from 'express';
import { query } from '../../config/database';
import { ok } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { resolveAllowedCompanyIds } from '../../utils/companyScope';

export const globalSearch = asyncHandler(async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const moduleFilter = typeof req.query.module === 'string' ? req.query.module.trim().toLowerCase() : 'all';

  if (!q || q.length < 2) {
    return ok(res, {
      companies: [],
      employees: [],
      candidates: [],
      jobs: []
    });
  }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const searchPattern = `%${q}%`;

  const results: {
    companies: any[];
    employees: any[];
    candidates: any[];
    jobs: any[];
  } = {
    companies: [],
    employees: [],
    candidates: [],
    jobs: []
  };

  // Determine which sections to query based on the module parameter
  const queryAll = moduleFilter === 'all';
  const queryCompanies = queryAll || moduleFilter === 'companies';
  const queryEmployees = queryAll || moduleFilter === 'employees';
  const queryCandidates = queryAll || moduleFilter === 'candidates';
  const queryJobs = queryAll || moduleFilter === 'jobs';

  const limitVal = queryAll ? 10 : 30;

  const queries: Promise<any>[] = [];

  // 1. Companies Query (Only relevant for super admins, but standard admins only see their own company/group)
  if (queryCompanies) {
    queries.push(
      query(
        `SELECT id, name, slug, logo_filename
         FROM companies
         WHERE id = ANY($1) 
           AND (name ILIKE $2 OR slug ILIKE $2)
         ORDER BY name
         LIMIT $3`,
        [allowedCompanyIds, searchPattern, limitVal]
      ).then((res) => {
        results.companies = res;
      })
    );
  }

  // 2. Employees Query (users table)
  if (queryEmployees) {
    queries.push(
      query(
        `SELECT u.id, u.name, u.surname, u.email, u.unique_id, u.role, u.company_id, c.name AS company_name
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         WHERE u.company_id = ANY($1)
           AND u.role != 'store_terminal'
           AND (u.name ILIKE $2 OR u.surname ILIKE $2 OR u.email ILIKE $2 OR u.unique_id ILIKE $2)
         ORDER BY u.surname, u.name
         LIMIT $3`,
        [allowedCompanyIds, searchPattern, limitVal]
      ).then((res) => {
        results.employees = res;
      })
    );
  }

  // 3. Candidates Query
  if (queryCandidates) {
    queries.push(
      query(
        `SELECT cand.id, cand.full_name, cand.email, cand.phone, cand.status, cand.company_id, c.name AS company_name, j.title AS job_title
         FROM candidates cand
         LEFT JOIN companies c ON c.id = cand.company_id
         LEFT JOIN job_postings j ON j.id = cand.job_posting_id
         WHERE cand.company_id = ANY($1)
           AND (cand.full_name ILIKE $2 OR cand.email ILIKE $2 OR cand.phone ILIKE $2)
         ORDER BY cand.full_name
         LIMIT $3`,
        [allowedCompanyIds, searchPattern, limitVal]
      ).then((res) => {
        results.candidates = res;
      })
    );
  }

  // 4. Job Postings Query
  if (queryJobs) {
    queries.push(
      query(
        `SELECT jp.id, jp.title, jp.status, jp.company_id, c.name AS company_name
         FROM job_postings jp
         LEFT JOIN companies c ON c.id = jp.company_id
         WHERE jp.company_id = ANY($1)
           AND (jp.title ILIKE $2 OR jp.description ILIKE $2)
         ORDER BY jp.title
         LIMIT $3`,
        [allowedCompanyIds, searchPattern, limitVal]
      ).then((res) => {
        results.jobs = res;
      })
    );
  }

  await Promise.all(queries);

  ok(res, results);
});
