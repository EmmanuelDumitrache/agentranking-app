export type PowerBoostCoordinateRow = {
  id: number | null;
  daoVotes: bigint | number | string | null;
  stakingVotes: bigint | number | string | null;
  rank: bigint | number | string | null;
  total: bigint | number | string;
};

export type PowerBoostCoordinate = {
  id: number;
  daoVotes: number;
  stakingVotes: number;
  rank: number;
};

export function safePowerBoostInteger(
  value: bigint | number | string | null | undefined,
  label: string,
): number {
  if (value == null) return 0;
  let asBigInt: bigint;
  try {
    asBigInt = typeof value === "bigint" ? value : BigInt(value);
  } catch (error) {
    throw new TypeError(`${label} is not an integer`, { cause: error });
  }
  if (asBigInt > BigInt(Number.MAX_SAFE_INTEGER) || asBigInt < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`${label} exceeds JavaScript safe-integer bounds`);
  }
  return Number(asBigInt);
}

export function mapPowerBoostCoordinateRows(rows: readonly PowerBoostCoordinateRow[]): {
  coordinates: PowerBoostCoordinate[];
  total: number;
} {
  const total = safePowerBoostInteger(rows[0]?.total ?? 0n, "PowerBoost total");
  const coordinates = rows.flatMap((row): PowerBoostCoordinate[] => {
    if (row.id == null || row.rank == null || row.daoVotes == null) return [];
    return [{
      id: row.id,
      daoVotes: safePowerBoostInteger(row.daoVotes, "PowerBoost DAO votes"),
      stakingVotes: safePowerBoostInteger(row.stakingVotes, "PowerBoost staking votes"),
      rank: safePowerBoostInteger(row.rank, "PowerBoost rank"),
    }];
  });
  return { coordinates, total };
}

export function hydratePowerBoostCoordinates<T extends { id: number }>(
  coordinates: readonly PowerBoostCoordinate[],
  rows: readonly T[],
): Array<T & Omit<PowerBoostCoordinate, "id">> {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  return coordinates.flatMap((coordinate): Array<T & Omit<PowerBoostCoordinate, "id">> => {
    const row = rowsById.get(coordinate.id);
    if (!row) return [];
    return [{
      ...row,
      daoVotes: coordinate.daoVotes,
      stakingVotes: coordinate.stakingVotes,
      rank: coordinate.rank,
    }];
  });
}
