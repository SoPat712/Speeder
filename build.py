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
            # Exclude specified directories
            dirs[:] = [
                d
                for d in dirs
                if os.path.join(root, d).replace(folder + os.sep, "")
                not in exclude_dirs
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


def update_version_line(file_path, new_base_version):
    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    new_version = f"{new_base_version}.0"
    updated = False

    for i, line in enumerate(lines):
        match = re.match(r'\s*"version":\s*"([^"]+)"', line)
        if match:
            old_version = match.group(1)
            lines[i] = re.sub(
                r'"version":\s*".+?"', f'"version": "{new_version}"', line
            )
            updated = True
            print(f"🛠️ Changed version from {old_version} ➜ {new_version}")
            break

    if updated:
        with open(file_path, "w", encoding="utf-8") as f:
            f.writelines(lines)
    else:
        print("⚠️ No version line found to update.")


def main():
    base_version = input("Enter the new base version (e.g., 1.2.2): ").strip()
    if not base_version:
        print("❌ No version entered. Exiting.")
        return

    current_dir = os.getcwd()
    exclude_files = [SCRIPT_NAME] + [
        f for f in os.listdir(current_dir) if f.endswith(".xpi")
    ]
    exclude_dirs = [".git"]

    # 1. Create videospeed-github.xpi
    zip_folder("videospeed-github.xpi", current_dir, exclude_files, exclude_dirs)
    print("✅ Created videospeed-github.xpi")

    # 2. Prepare temporary folder
    with tempfile.TemporaryDirectory() as temp_dir:
        for item in os.listdir(current_dir):
            if item in exclude_files or item in exclude_dirs:
                continue
            s = os.path.join(current_dir, item)
            d = os.path.join(temp_dir, item)
            if os.path.isdir(s):
                shutil.copytree(s, d)
            else:
                shutil.copy2(s, d)

        # 3. Modify manifest.json version
        manifest_path = os.path.join(temp_dir, TARGET_FILE)
        if os.path.exists(manifest_path):
            update_version_line(manifest_path, base_version)
        else:
            print(f"⚠️ {TARGET_FILE} not found in copied files.")

        # 4. Zip modified files
        zip_folder(
            "videospeed-firefox.xpi", temp_dir, exclude_files=[], exclude_dirs=[]
        )
        print("✅ Created videospeed-firefox.xpi")


if __name__ == "__main__":
    main()
