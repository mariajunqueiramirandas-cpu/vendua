/** KpiStrip cells are min-w-28 + nowrap, so long money values spill into the next cell;
 *  sizing cells to their content lets the strip scroll instead. */
export const KPI_FIT = '[&>div>*]:min-w-fit';
