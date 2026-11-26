import { SERVICE_LAUNCHER_CONTEXT_ENV } from "../service/serviceProtocol.ts";

// Agents inside a managed Orbi service inherit its home and launcher context; CI has neither.
for (const name of ["ORBIWORK_HOME", "ORBI_BOOT_SERVICE_UNIT", SERVICE_LAUNCHER_CONTEXT_ENV]) {
  delete process.env[name];
}
