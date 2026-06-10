import { blue } from 'kolorist';
import pkg from '../../package.json' with { type: 'json' };

const banner = blue(`SAP LeanIX Custom Report Creation Tool v${pkg.version}`);

export default banner;
