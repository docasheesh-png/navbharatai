/** Library batch 5 (2026-11-19): public buildings, homes, nature, farm, street items and dirt roads (kayquer kits, CC0). */
import { P, type Row } from './packs.mts';

export const REVIEWED_AT = '2026-11-19';
const r = (id: string, pack: Row['pack'], file: string, subject: string, category: Row['category'], height: number): Row => ({ id, pack, file: `${file}.glb`, subjects: [subject], category, height });
export const ROWS: Row[] = [
  // Public buildings
  r('lib5-school', P.city2, 'publicos/escola', 'school', 'building', 8), r('lib5-hospital', P.city2, 'publicos/hospital', 'hospital', 'building', 14),
  r('lib5-police-station', P.city2, 'publicos/policia', 'police station', 'building', 7), r('lib5-fire-station', P.city2, 'publicos/bombeiros', 'fire station', 'building', 8),
  r('lib5-library', P.city2, 'publicos/biblioteca', 'library', 'building', 8), r('lib5-museum', P.city2, 'publicos/museu', 'museum', 'building', 10),
  r('lib5-town-hall', P.city2, 'publicos/prefeitura', 'town hall', 'building', 12), r('lib5-university', P.city2, 'publicos/universidade', 'university', 'building', 14),
  r('lib5-monument', P.city2, 'publicos/monumento', 'monument', 'building', 6),
  // Commerce and industry
  r('lib5-bank', P.city2, 'comercial/banco', 'bank', 'building', 9), r('lib5-hotel', P.city2, 'comercial/hotel', 'hotel', 'building', 20),
  r('lib5-shopping-mall', P.city2, 'comercial/shopping', 'shopping mall', 'building', 12), r('lib5-restaurant', P.city2, 'comercial/restaurante', 'restaurant', 'building', 6),
  r('lib5-supermarket', P.city2, 'comercial/mercado', 'supermarket', 'building', 6), r('lib5-ev-charger', P.city2, 'comercial/posto_recarga', 'charging station', 'street-prop', 3),
  r('lib5-factory', P.city2, 'industrial/fabrica', 'factory', 'building', 12), r('lib5-warehouse', P.city2, 'industrial/galpao', 'warehouse', 'building', 8),
  r('lib5-port', P.city2, 'industrial/porto', 'port', 'building', 10), r('lib5-skyscraper', P.city2, 'residencial/predio_alto', 'skyscraper', 'building', 45),
  r('lib5-apartment', P.city2, 'residencial/predio_apartamentos', 'apartment', 'building', 18), r('lib5-bakery', P.buildings2, 'comercial/padaria_toldo', 'bakery', 'building', 6),
  // Energy
  r('lib5-dam', P.city2, 'energia/hidreletrica', 'dam', 'building', 25), r('lib5-wind-farm', P.city2, 'energia/parque_eolico', 'wind farm', 'building', 30),
  r('lib5-nuclear-plant', P.city2, 'energia/usina_nuclear', 'nuclear plant', 'building', 30), r('lib5-solar-farm', P.city2, 'energia/usina_solar', 'solar farm', 'building', 3),
  // Nature
  r('lib5-coconut-palm', P.props2, 'natureza/coqueiro', 'palm tree', 'vegetation', 8), r('lib5-banana-plant', P.props2, 'natureza/bananeira', 'banana tree', 'vegetation', 4),
  r('lib5-bamboo', P.props2, 'natureza/bambu', 'bamboo', 'vegetation', 6), r('lib5-tree-stump', P.props2, 'natureza/toco', 'tree stump', 'vegetation', 0.6),
  r('lib5-fallen-log', P.props2, 'natureza/tronco_caido', 'log', 'rock', 0.6), r('lib5-rocks', P.props2, 'natureza/pedras', 'rock pile', 'rock', 0.8),
  r('lib5-flowers', P.props2, 'natureza/flores_campo', 'flowers', 'vegetation', 0.4), r('lib5-tall-grass', P.props2, 'natureza/capim_alto', 'tall grass', 'vegetation', 1.2),
  r('lib5-giant-water-lily', P.props2, 'natureza/vitoria_regia', 'lotus leaf', 'vegetation', 0.1), r('lib5-termite-mound', P.props2, 'natureza/cupinzeiro', 'termite mound', 'rock', 1.2),
  // Farm
  r('lib5-scarecrow', P.props2, 'rural/espantalho', 'scarecrow', 'street-prop', 1.9), r('lib5-hay-bale', P.props2, 'rural/fardo_feno', 'hay bale', 'container', 1),
  r('lib5-beehive', P.props2, 'rural/colmeia', 'beehive', 'container', 0.6), r('lib5-farm-gate', P.props2, 'rural/porteira', 'farm gate', 'street-prop', 1.4),
  r('lib5-firewood', P.props2, 'rural/pilha_lenha', 'firewood', 'container', 0.8), r('lib5-vegetable-garden', P.props2, 'rural/horta', 'vegetable garden', 'vegetation', 0.5),
  // Street items
  r('lib5-traffic-cone', P.props2, 'rua/cone_transito', 'traffic cone', 'street-prop', 0.7), r('lib5-popcorn-cart', P.props2, 'rua/carrinho_pipoca', 'food cart', 'street-prop', 1.8),
  r('lib5-market-stall', P.props2, 'rua/barraca_feira', 'market stall', 'street-prop', 2.4), r('lib5-stop-sign', P.city2, 'mobiliario/placa_pare', 'stop sign', 'street-prop', 2.2),
  r('lib5-bus-stop', P.city2, 'mobiliario/ponto_onibus', 'bus stop', 'street-prop', 2.6), r('lib5-playground', P.city2, 'mobiliario/parquinho', 'playground', 'street-prop', 2.5),
  r('lib5-wheelbarrow', P.props2, 'rua/carrinho_mao', 'wheelbarrow', 'container', 0.7),
  // Dirt roads (kaccha road) and a road bridge
  r('lib5-dirt-road', P.city2, 'ruas/terra_reta', 'dirt road tile', 'terrain', 0.1), r('lib5-dirt-road-curve', P.city2, 'ruas/terra_curva', 'dirt road curve tile', 'terrain', 0.1),
  r('lib5-zebra-crossing', P.city2, 'ruas/asfalto_faixa_pedestre', 'zebra crossing tile', 'terrain', 0.1), r('lib5-road-bridge', P.city2, 'ruas/ponte', 'road bridge', 'building', 3),
];
