FROM pgvector/pgvector:pg17

EXPOSE 5432

RUN echo "CREATE EXTENSION IF NOT EXISTS vector;" > /docker-entrypoint-initdb.d/init-pgvector.sql

USER root
ENTRYPOINT ["sh", "-c", "chown -R postgres:postgres /var/lib/postgresql/data && chmod 700 /var/lib/postgresql/data && exec /usr/local/bin/docker-entrypoint.sh postgres"]
