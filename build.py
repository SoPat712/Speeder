import glob
import fnmatch
import os
import re
import shutil
import tempfile
import zipfile

SCRIPT_NAME = os.path.basename(__file__)
TARGET_FILE = "manifest.json"
DEFAULT_EXCLUDE_FILES = {".DS_Store"}
DEFAULT_EXCLUDE_DIRS = {"__pycache__"}
DEFAULT_EXCLUDE_PATTERNS = {"._*", "*.pyc"}


def should_exclude(rel_path, exclude_files, exclude_dirs):
    rel_path = os.path.normpath(rel_path)
    path_parts = rel_path.split(os.sep)
    file_name = path_parts[-1]

    if file_name in DEFAULT_EXCLUDE_FILES or rel_path in DEFAULT_EXCLUDE_FILES:
        return True

    if any(part in DEFAULT_EXCLUDE_DIRS for part in path_parts):
        return True

    if file_name in exclude_files or rel_path in exclude_files:
        return True

    if any(part in exclude_dirs for part in path_parts):
        return True

    if any(fnmatch.fnmatch(file_name, pattern) for pattern in DEFAULT_EXCLUDE_PATTERNS):
        return True

    return False


def zip_folder(output_name, folder, exclude_files, exclude_dirs):
    with zipfile.ZipFile(output_name, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(folder):
            dirs[:] = [
                d
                for d in dirs
                if not should_exclude(
                    os.path.relpath(os.path.join(root, d), folder),
                    exclude_files,
                    exclude_dirs,
                )
            ]
            for file in files:
                rel_path = os.path.relpath(os.path.join(root, file), folder)
                if should_exclude(rel_path, exclude_files, exclude_dirs):
                    continue
                zipf.write(os.path.join(root, file), arcname=rel_path)


def update_version_line(file_path, new_version):
    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    updated = False
    for i, line in enumerate(lines):
        match = re.match(r'\s*"version":\s*"([^"]+)"', line)
        if match:
            old_version = match.group(1)
            lines[i] = re.sub(
                r'"version":\s*".+?"', f'"version": "{new_version}"', line
            )
            updated = True
            print(
                f"🛠️ Changed version in {file_path} from {old_version} ➜ {new_version}"
            )
            break

    if updated:
        with open(file_path, "w", encoding="utf-8") as f:
            f.writelines(lines)
    else:
        print(f"⚠️ No version line found in {file_path}.")


def main():
    # Step 0: Remove all existing .xpi files upfront
    xpi_files = glob.glob("*.xpi")
    for f in xpi_files:
        try:
            os.remove(f)
            print(f"🗑️ Removed existing archive: {f}")
        except Exception as e:
            print(f"⚠️ Failed to remove {f}: {e}")

    # Read current version from manifest.json
    current_dir = os.getcwd()
    manifest_path = os.path.join(current_dir, TARGET_FILE)
    current_version = "unknown"
    
    if os.path.exists(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as f:
            for line in f:
                match = re.match(r'\s*"version":\s*"([^"]+)"', line)
                if match:
                    current_version = match.group(1)
                    break
    
    print(f"📦 Current version: {current_version}")
    base_version = input("Enter the new base version (e.g., 2.0.1): ").strip()
    if not base_version:
        print("❌ No version entered. Exiting.")
        return

    firefox_version = f"{base_version}.0"

    # Step 1: Update manifest.json on disk to base_version
    if os.path.exists(manifest_path):
        update_version_line(manifest_path, base_version)
    else:
        print(f"❌ {TARGET_FILE} not found. Aborting.")
        return

    # Step 2: Create videospeed-github.xpi (exclude script, .git, AND videospeed-github.xpi itself)
    exclude_files = [SCRIPT_NAME, "videospeed-github.xpi"]
    exclude_dirs = [".git"]
    zip_folder("videospeed-github.xpi", current_dir, exclude_files, exclude_dirs)
    print("✅ Created videospeed-github.xpi")

    # Step 3: Re-scan for .xpi files after GitHub archive creation, exclude them for Firefox zip
    current_xpi_files = set(glob.glob("*.xpi"))
    exclude_temp_files = current_xpi_files.union({SCRIPT_NAME})
    exclude_temp_dirs = set(exclude_dirs)

    # Step 4: Create videospeed-firefox.xpi from temp folder with version bumped to .0
    with tempfile.TemporaryDirectory() as temp_dir:
        for item in os.listdir(current_dir):
            if should_exclude(item, exclude_temp_files, exclude_temp_dirs):
                continue
            src = os.path.join(current_dir, item)
            dst = os.path.join(temp_dir, item)
            if os.path.isdir(src):
                shutil.copytree(src, dst)
            else:
                shutil.copy2(src, dst)

        temp_manifest = os.path.join(temp_dir, TARGET_FILE)
        if os.path.exists(temp_manifest):
            update_version_line(temp_manifest, firefox_version)
        else:
            print(f"⚠️ {TARGET_FILE} not found in temp folder.")

        zip_folder(
            "videospeed-firefox.xpi", temp_dir, exclude_files=[], exclude_dirs=[]
        )
        print("✅ Created videospeed-firefox.xpi")


if __name__ == "__main__":
    main()
