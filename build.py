import os
import re
import shutil
import tempfile
import zipfile

SCRIPT_NAME = os.path.basename(__file__)
TARGET_FILE = "manifest.json"


def zip_folder(output_name, folder, exclude_files, exclude_dirs):
    with zipfile.ZipFile(output_name, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(folder):
            dirs[:] = [
                d
                for d in dirs
                if os.path.relpath(os.path.join(root, d), folder) not in exclude_dirs
            ]
            for file in files:
                rel_path = os.path.relpath(os.path.join(root, file), folder)
                if (
                    file in exclude_files
                    or rel_path in exclude_files
                    or any(rel_path.startswith(ed + os.sep) for ed in exclude_dirs)
                ):
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
    base_version = input("Enter the new base version (e.g., 2.0.1): ").strip()
    if not base_version:
        print("❌ No version entered. Exiting.")
        return

    firefox_version = f"{base_version}.0"
    current_dir = os.getcwd()
    manifest_path = os.path.join(current_dir, TARGET_FILE)

    # Determine what to exclude
    exclude_files = [SCRIPT_NAME] + [
        f for f in os.listdir(current_dir) if f.endswith(".xpi")
    ]
    exclude_dirs = [".git"]

    # Step 1: Update manifest.json on disk
    if os.path.exists(manifest_path):
        update_version_line(manifest_path, base_version)
    else:
        print(f"❌ {TARGET_FILE} not found. Aborting.")
        return

    # Step 2: Create GitHub .xpi archive
    zip_folder("videospeed-github.xpi", current_dir, exclude_files, exclude_dirs)
    print("✅ Created videospeed-github.xpi")

    # Step 3: Prepare Firefox archive with version bumped to .0
    with tempfile.TemporaryDirectory() as temp_dir:
        for item in os.listdir(current_dir):
            if item in exclude_files or item in exclude_dirs:
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
