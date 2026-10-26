# library-service

Development foundation only. GET /api/resources reads seeded sample records from PostgreSQL. GET /health checks the process; GET /ready checks the database; GET /dependencies checks configured upstream services.

The full ERD, authentication and business operations are not implemented. Run the whole foundation from the repository root with `docker compose up`.
