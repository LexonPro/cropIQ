import re

# Read index.html
with open("index.html", "r", encoding="utf-8") as f:
    html = f.read()

# Selectors to check
selectors = [
    ("soilTabContent", 'id="soilTabContent"'),
    ("diseaseTabContent", 'id="diseaseTabContent"'),
    ("mandiTabContent", 'id="mandiTabContent"'),
    ("soil-tab-btn", 'id="soil-tab-btn"'),
    ("disease-tab-btn", 'id="disease-tab-btn"'),
    ("mandi-tab-btn", 'id="mandi-tab-btn"'),
    ("predictBtn", 'id="predictBtn"'),
    ("results", 'id="results"'),
    ("advisoryWrap", 'id="advisoryWrap"'),
    ("lblStepDisease", 'id="lblStepDisease"'),
    ("lblTitleDisease", 'id="lblTitleDisease"'),
    ("lblSubDisease", 'id="lblSubDisease"'),
    ("lblUploadClick", 'id="lblUploadClick"'),
    ("lblUploadFormats", 'id="lblUploadFormats"'),
    ("lblStepMandi", 'id="lblStepMandi"'),
    ("lblTitleMandi", 'id="lblTitleMandi"'),
    ("lblSubMandi", 'id="lblSubMandi"'),
]

print("--- Checking ID elements in index.html ---")
for name, pattern in selectors:
    found = pattern in html
    print(f"ID '{name}': {'FOUND' if found else 'NOT FOUND ❌'}")

# Check nested class query selectors
print("\n--- Checking nested class query selectors ---")
# 1. #soilTabContent .section-title
has_soil_title = 'id="soilTabContent"' in html and 'class="section-title"' in html
print("soilTabContent title/label components: ", has_soil_title)

# Let's inspect the actual DOM tree hierarchy around results and advisory
print("\n--- results structure check ---")
print("results container in HTML:", 'id="results"' in html)
print("advisoryWrap container in HTML:", 'id="advisoryWrap"' in html)
