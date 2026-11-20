import 'reflect-metadata';
import fs from 'fs';
import { sequelize } from './config/database.js';
import { seed } from './config/seed.js';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { ensureInventorySchema } from './config/inventorySchema.js';
import { User } from './models/User.js';

// Ensure required directories exist
['./data', './logs', env.uploadDir, './data/restore'].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

async function bootstrap() {
  try {
    await sequelize.authenticate();
    logger.info('Database connection established');

    await sequelize.sync({ force: env.isDevelopment || env.isTest });
    await ensureInventorySchema();
    logger.info('Database synchronized');

    if (await User.count() === 0) await seed();

    const app = createApp();
    app.listen(env.port, () => {
      logger.info(`${env.appName} v${env.appVersion} running on port ${env.port} [${env.nodeEnv}]`);
      logger.info(`Swagger UI: http://localhost:${env.port}/swagger-ui`);
    });
  } catch (err) {
    logger.error(`Bootstrap failed: ${err}`);
    process.exit(1);
  }
}

bootstrap();
