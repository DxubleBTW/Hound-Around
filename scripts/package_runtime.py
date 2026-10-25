"""Create a private manifest after freezing reviewed code, data and calibration."""
import argparse
import json
from pathlib import Path

from ml.artifacts import build_manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        manifest = build_manifest(args.data_dir)
        (args.data_dir / 'runtime-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print('Wrote private runtime-manifest.json. Publish only through the private dataset.')


if __name__ == '__main__':
    main()
