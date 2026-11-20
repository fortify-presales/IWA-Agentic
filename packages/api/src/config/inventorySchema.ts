import { DataTypes } from 'sequelize';
import { sequelize } from './database.js';

export async function ensureInventorySchema() {
  const query = sequelize.getQueryInterface();
  const columns = await query.describeTable('products');
  if (!columns.lowStockThreshold) {
    await query.addColumn('products', 'lowStockThreshold', {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5,
    });
  }
}
