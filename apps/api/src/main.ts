/**
 * API process entry point.
 *
 * Responsibilities, in order: load validated configuration, open the database
 * connection, listen, and on a signal close cleanly. Anything that fails here
 * stops the process — a clinic API that starts in a broken state is worse than
 * one that refuses to start.
 */

import { buildServer } from './app.js';
import { ConfigurationError, loadApiConfig } from './config/env.js';

async function main(): Promise<void> {
  // Validate configuration before doing any work, so a missing DATABASE_URL
  // produces one readable message instead of a stack trace from postgres.
  loadApiConfig();

  const server = await buildServer();
  const config = loadApiConfig();

  let closing = false;
  const stop = async (signal: NodeJS.Signals): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    server.log.info({ signal }, 'Shutting down');

    // Give in-flight requests a moment; a clinic operator closing the app should
    // never lose a save that is already being written.
    const forcedExit = setTimeout(() => {
      server.log.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, 10_000);
    forcedExit.unref();

    try {
      await server.close();
      clearTimeout(forcedExit);
      process.exit(0);
    } catch (error) {
      server.log.error({ err: error }, 'Failed to shut down cleanly');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));

  // An unhandled rejection in a request handler would otherwise leave the
  // process in an unknown state.
  process.on('unhandledRejection', (reason) => {
    server.log.error({ err: reason }, 'Unhandled promise rejection');
  });

  await server.listen({ host: config.host, port: config.port });
  server.log.info(
    { url: `http://${config.host}:${config.port}`, environment: config.nodeEnv },
    'Denti-Code U3 API listening',
  );
}

main().catch((error: unknown) => {
  if (error instanceof ConfigurationError) {
    console.error(error.message);
    process.exit(78); // EX_CONFIG
  }
  console.error('The API failed to start:', error);
  process.exit(1);
});
