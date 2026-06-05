source "https://rubygems.org"

gem "fastlane"
# fastlane laddar alla default-actions vid start (inkl. Google Play-actions) som
# behöver multi_json via representable/json. Bundler 4 tar inte med den automatiskt
# → måste deklareras explicit, annars "multi_json is not part of the bundle".
gem "multi_json"
