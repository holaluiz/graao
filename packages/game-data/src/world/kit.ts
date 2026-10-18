/**
 * GRAAO world kit: every modular piece the planet's regions are built from, by family (docs/world/MG_ARCHITECTURE_KITS.md).
 * The core (types, palette, dimensions, builders) is kitCore.ts; each family registers its prefabs and buildings when
 * imported: kitProps (props brasileiros), kitUrbano (URBANO_BH), kitColonial (COLONIAL), kitModernista (MODERNISTA),
 * kitNatural (SERRA, BOSQUE).
 */
import './kitProps';
import './kitUrbano';
import './kitColonial';
import './kitModernista';
import './kitNatural';
import { buildingRegistry, checkBuildings, prefabRegistry, type KitBuilding, type KitPrefab } from './kitCore';

export * from './kitCore';
export { COLONIAL_TONES, type ColonialTone } from './kitColonial';
export { PILOTIS } from './kitModernista';

/** Every prefab by id. */
export const KIT_PREFABS: Record<string, KitPrefab> = prefabRegistry();
/** Every building by id. */
export const KIT_BUILDINGS: Record<string, KitBuilding> = buildingRegistry();
checkBuildings();
