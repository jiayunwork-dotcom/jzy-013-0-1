import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** One /batch submission: number of items, how many succeeded/failed. */
@Entity('calc_batches')
export class BatchRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  totalItems!: number;

  @Column({ type: 'int' })
  successCount!: number;

  @Column({ type: 'int' })
  failureCount!: number;

  @Index()
  @CreateDateColumn()
  createdAt!: Date;
}
