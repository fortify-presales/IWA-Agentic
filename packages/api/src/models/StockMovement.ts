import { Table, Column, Model, DataType, PrimaryKey, Default, CreatedAt } from 'sequelize-typescript';
import { v4 as uuidv4 } from 'uuid';

@Table({ tableName: 'stock_movements', timestamps: false })
export class StockMovement extends Model {
  @PrimaryKey
  @Default(uuidv4)
  @Column(DataType.STRING)
  declare id: string;

  @Column(DataType.STRING)
  declare productId: string;

  @Column(DataType.STRING)
  declare type: 'adjustment' | 'checkout';

  @Column(DataType.INTEGER)
  declare change: number;

  @Column(DataType.INTEGER)
  declare stockAfter: number;

  @Column(DataType.STRING)
  declare orderId: string | null;

  @Column(DataType.STRING)
  declare userId: string | null;

  @CreatedAt
  @Default(DataType.NOW)
  @Column(DataType.DATE)
  declare createdAt: Date;
}
