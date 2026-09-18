import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One calculation request and its result.
 *
 * Single /mode and /ripple calls create a row with batchId = NULL.
 * Batch calls create one row per item (itemIndex set) linked to a BatchRecord.
 * Failures are also persisted (mode NULL, errors JSON populated) so the
 * history reflects exactly what the service received and returned.
 */
@Entity('calc_records')
export class CalcRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Which logical endpoint produced the row: mode | ripple | batch. */
  @Index()
  @Column({ type: 'varchar', length: 16 })
  endpoint!: string;

  /** Owning batch id, NULL for single calls. */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  batchId!: string | null;

  /** 0-based position inside a batch, NULL for single calls. */
  @Column({ type: 'int', nullable: true })
  itemIndex!: number | null;

  @Index()
  @Column({ type: 'boolean' })
  success!: boolean;

  /** Detected mode: CCM | DCM | BOUNDARY, NULL when validation failed. */
  @Index()
  @Column({ type: 'varchar', length: 8, nullable: true })
  mode!: string | null;

  // --- input parameters (NULL if not parseable) ---
  @Column({ type: 'float', nullable: true })
  inputVoltage!: number | null;
  @Column({ type: 'float', nullable: true })
  dutyCycle!: number | null;
  @Column({ type: 'float', nullable: true })
  inductance!: number | null;
  @Column({ type: 'float', nullable: true })
  capacitance!: number | null;
  @Column({ type: 'float', nullable: true })
  switchPeriod!: number | null;
  @Column({ type: 'float', nullable: true })
  loadResistance!: number | null;
  @Column({ type: 'float', nullable: true })
  esr!: number | null;

  // --- key results ---
  @Column({ type: 'float', nullable: true })
  outputVoltage!: number | null;
  @Column({ type: 'float', nullable: true })
  ccmOutputVoltage!: number | null;
  @Column({ type: 'float', nullable: true })
  inductorCurrentRipple!: number | null;
  @Column({ type: 'float', nullable: true })
  capacitorVoltageRipple!: number | null;
  @Column({ type: 'float', nullable: true })
  totalOutputVoltageRipple!: number | null;

  /** Full structured input echo and full result payload. */
  @Column({ type: 'simple-json', nullable: true })
  request!: Record<string, unknown> | null;
  @Column({ type: 'simple-json', nullable: true })
  result!: Record<string, unknown> | null;
  /** Validation field errors when the item failed. */
  @Column({ type: 'simple-json', nullable: true })
  errors!: Record<string, unknown>[] | null;

  @Index()
  @CreateDateColumn()
  createdAt!: Date;
}
