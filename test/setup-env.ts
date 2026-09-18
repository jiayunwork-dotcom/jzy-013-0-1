// Runs before any test module is imported: force an in-process sql.js database
// so the full HTTP + persistence stack can be exercised without PostgreSQL.
process.env.DB_TYPE = 'sqljs';
process.env.NODE_ENV = 'test';
process.env.VOLT_SECOND_TOL = process.env.VOLT_SECOND_TOL || '1e-9';
process.env.BOUNDARY_TOL = process.env.BOUNDARY_TOL || '1e-12';
