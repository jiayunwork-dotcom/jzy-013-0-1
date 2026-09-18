/**
 * Numerical tolerances and fixed physical configuration of the averaged model.
 *
 * These values can be overridden through environment variables (see
 * CalcConfigService) but the defaults below are what every calculation uses.
 */
export const DEFAULT_VOLT_SECOND_TOL = 1e-9;
export const DEFAULT_BOUNDARY_TOL = 1e-12;

/**
 * The buck converter's dimensionless parameter:
 *
 *     K = 2 L / (R * Ts)
 *
 * CCM  <=>  K >= Kcrit(D)
 * DCM  <=>  K <  Kcrit(D)
 *
 * The critical value derived from the switched inductor current valley
 * reaching zero (and from demanding that the DCM voltage solution join the
 * CCM solution continuously at the boundary) is:
 *
 *     Kcrit(D) = 1 - D
 *
 * NOTE ON THE SPEC WORDING: the task brief states "the larger the duty cycle,
 * the easier it is to enter DCM". That is the opposite of what the buck
 * averaged equations yield: Kcrit = 1 - D decreases with D, so a larger duty
 * cycle makes CCM *easier* to sustain (the off-time is shorter, so the
 * inductor current has less time to decay to zero). Implementing an increasing
 * boundary such as Kcrit = D would break the requirement that the DCM voltage
 * must join D*Vin continuously at the boundary. We therefore keep the
 * physically consistent 1 - D boundary and surface it explicitly on the
 * configuration endpoint. All behavioural invariants requested in the brief
 * (L reduced below the boundary flips to DCM with a higher output voltage,
 * doubling D doubles the CCM output, doubling Ts doubles the CCM ripple,
 * scaling Vin scales output and ripple) hold with this boundary.
 */
export const KCRIT_FORMULA = 'Kcrit(D) = 1 - D';
export const K_FORMULA = 'K = 2L / (R * Ts)';
