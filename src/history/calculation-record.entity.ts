import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type RequestType = 'single' | 'ripple' | 'batch';

/**
 * 每次核算请求与结果的持久化记录。
 * 批量提交中的每一组参数各写一条，用 batchId 关联。
 */
@Entity('calculation_records')
export class CalculationRecord {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'varchar', length: 16 })
  requestType!: RequestType;

  /** 批量核算时同一批记录共享的 id；单次/纹波接口为 null */
  @Index()
  @Column({ type: 'varchar', length: 36, nullable: true })
  batchId!: string | null;

  /** 批量内第几组（从 1 开始）；非批量为 null */
  @Column({ type: 'int', nullable: true })
  batchIndex!: number | null;

  /** 原始请求参数 */
  @Column({ type: 'simple-json', nullable: true })
  input!: unknown;

  /** 是否核算成功（参数合法且计算闭合） */
  @Index()
  @Column({ type: 'boolean' })
  success!: boolean;

  /** CCM / DCM；失败时为 null */
  @Index()
  @Column({ type: 'varchar', length: 8, nullable: true })
  mode!: string | null;

  /** 计算结果（完整快照）；失败时为 null */
  @Column({ type: 'simple-json', nullable: true })
  result!: unknown;

  /** 可读错误信息（成功时为 null） */
  @Column({ type: 'simple-json', nullable: true })
  errors!: unknown;

  @CreateDateColumn()
  createdAt!: Date;
}
