from html.parser import HTMLParser

class SelectorParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tag_stack = []
        self.current_ids = []
        self.found = {
            '#soilTabContent .section-title': False,
            '#soilTabContent .section-sub': False,
            '#soilTabContent .section-label': False,
            '#results .section-title': False,
            '#results .section-sub': False,
            '#results .section-label': False,
            '#advisoryWrap .section-title': False,
            '#advisoryWrap .section-sub': False,
            '#advisoryWrap .section-label': False,
        }

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        tag_id = attrs_dict.get('id')
        tag_class = attrs_dict.get('class', '')
        
        # Track active IDs in ancestor chain
        active_id = None
        if tag_id:
            active_id = tag_id
        elif self.tag_stack:
            active_id = self.tag_stack[-1][1]
            
        self.tag_stack.append((tag, active_id))
        
        # Verify selectors
        if active_id in ['soilTabContent', 'results', 'advisoryWrap']:
            classes = tag_class.split()
            for c in classes:
                sel = f"#{active_id} .{c}"
                if sel in self.found:
                    self.found[sel] = True

    def handle_endtag(self, tag):
        if self.tag_stack:
            self.tag_stack.pop()

# Read index.html
with open("index.html", "r", encoding="utf-8") as f:
    html = f.read()

parser = SelectorParser()
parser.feed(html)

print("--- Validating DOM nested classes in index.html ---")
for sel, found in parser.found.items():
    print(f"Selector '{sel}': {'FOUND' if found else 'NOT FOUND [MISSING] [WARNING]'}")
