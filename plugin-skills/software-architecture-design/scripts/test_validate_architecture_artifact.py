"""Architecture marker compatibility and placeholder regression checks."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('architecture_validator', ROOT / 'scripts/validate_architecture_artifact.py')
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)

class ArchitectureValidationTests(unittest.TestCase):
    def check_text(self, text):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'design.md'
            path.write_text(text, encoding='utf-8')
            return validator.validate(path, False)

    def setUp(self):
        self.example = (ROOT / 'references/example-cross-module-architecture-design.md').read_text(encoding='utf-8')

    def test_complete_example_with_source_markers(self):
        self.assertEqual(self.check_text(self.example), [])

    def test_valid_source_marker_whitespace(self):
        text = self.example.replace("<!-- architecture-id: 示例-申请-机制 -->", "  <!-- architecture-id: 示例-申请-机制 -->  ")
        self.assertEqual(self.check_text(text), [])

    def test_old_eight_section_documents_remain_accepted(self):
        import re
        old = re.sub(r'^<!-- architecture-id:.*-->\n', '', self.example, flags=re.M)
        self.assertEqual(self.check_text(old), [])

    def test_unfilled_marker_is_not_exempt(self):
        text = self.example.replace('architecture-id: 示例-申请-机制', 'architecture-id: <scope>-mechanisms')
        self.assertTrue(any('占位符' in error for error in self.check_text(text)))

    def test_non_marker_placeholder_still_fails(self):
        for placeholder in ('<未填写>', '<!-- <待填> -->', 'YYYY-MM-DD'):
            with self.subTest(placeholder=placeholder):
                self.assertTrue(any('占位符' in error for error in self.check_text(self.example + '\n' + placeholder)))

    def test_structural_contract_remains_enforced(self):
        self.assertTrue(any('缺少固定章节' in error for error in self.check_text(self.example.replace('## 7. 验证与可观测性', '## 检查'))))
        self.assertTrue(any('status' in error for error in self.check_text(self.example.replace('| Status | proposed |', '| Status | confirmed |'))))

    def test_templates_are_only_valid_in_template_mode(self):
        for name in ('architecture-design-template.md', 'adr-template.md', 'rfc-template.md'):
            with self.subTest(name=name):
                path = ROOT / 'assets' / name
                self.assertEqual(validator.validate(path, True), [])
                self.assertTrue(validator.validate(path, False))

if __name__ == '__main__':
    unittest.main()
