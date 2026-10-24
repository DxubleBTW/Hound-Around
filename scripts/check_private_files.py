"""Reject known private collection artifacts in Git, including forced adds."""
from pathlib import PurePosixPath
import subprocess
import sys


def violations(paths):
    blocked = []
    for name in paths:
        path = PurePosixPath(name)
        lower = str(path).lower()
        basename = path.name.lower()
        docs_diagram = lower.startswith('docs/img/') and path.suffix.lower() == '.png'
        private = (
            lower.startswith('data/')
            or basename in ('graph.json', 'rooms.json', 'index.npz', 'corrections.sqlite')
            or path.suffix.lower() in ('.mov', '.mp4', '.m4v', '.avi', '.mkv', '.heic', '.jpg', '.jpeg', '.pdf', '.npz', '.sqlite', '.db')
            or '.sqlite-' in basename or '.db-' in basename
            or (path.suffix.lower() in ('.png', '.webp', '.tiff', '.tif') and not docs_diagram)
            or (basename.startswith('.env') and basename not in ('.env.example',))
        )
        if private:
            blocked.append(name)
    return blocked


def main():
    paths = subprocess.check_output(['git', 'ls-files', '-z']).decode('utf-8').split('\0')
    blocked = violations(filter(None, paths))
    if blocked:
        print('Private collection artifacts must not be tracked:\n' + '\n'.join(blocked), file=sys.stderr)
        return 1
    print('No known private collection artifacts are tracked. Human diff review is still required.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
