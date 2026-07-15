import type { DbEngine } from "@/lib/types";

/**
 * Catálogo de bancos de dados (engine → rótulo, imagem docker, versões).
 * Espelha api/projects.py::DB_ENGINES — manter em sincronia.
 */
export type DbEngineInfo = {
  label: string;
  image: string;
  versions: string[];   // primeira = padrão
};

export const DB_ENGINES: Record<DbEngine, DbEngineInfo> = {
  postgres: { label: "PostgreSQL", image: "postgres", versions: ["18", "17", "16"] },
  mysql: { label: "MySQL", image: "mysql", versions: ["8"] },
  mariadb: { label: "MariaDB", image: "mariadb", versions: ["11"] },
  mongodb: { label: "MongoDB", image: "mongo", versions: ["8"] },
  redis: { label: "Redis", image: "redis", versions: ["7", "6"] },
  cassandra: { label: "Cassandra", image: "cassandra", versions: ["5"] },
};

export const DB_ENGINE_ORDER: DbEngine[] = [
  "postgres", "mongodb", "mysql", "mariadb", "redis", "cassandra",
];
