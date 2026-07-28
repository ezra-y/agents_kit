import json
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import scripts.manage as manage


class ManageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = self.temp.name
        manage.REPO = root
        manage.SKILLS_DIR = os.path.join(root, 'skills')
        manage.ACTIVE_PATH = os.path.join(root, 'active.txt')
        manage.SOURCES_PATH = os.path.join(root, 'sources.json')
        manage.METADATA_PATH = os.path.join(root, 'metadata.json')
        manage.DESTS = (
            os.path.join(root, 'home', '.claude', 'skills'),
            os.path.join(root, 'home', '.agents', 'skills'),
        )
        os.makedirs(os.path.join(manage.SKILLS_DIR, 'tools', 'alpha'))
        os.makedirs(os.path.join(manage.SKILLS_DIR, 'web', 'beta'))
        for category, name in (('tools', 'alpha'), ('web', 'beta')):
            path = os.path.join(manage.SKILLS_DIR, category, name, 'SKILL.md')
            with open(path, 'w', encoding='utf-8') as f:
                f.write(f'---\nname: {name}\ndescription: test\n---\n')
        manage.write_active(['alpha', 'beta'])
        manage.save_json(
            manage.SOURCES_PATH,
            {
                'skills': {
                    'alpha': {
                        'type': 'github',
                        'repo': 'owner/repo',
                        'branch': 'main',
                        'path': 'alpha',
                        'category': 'tools',
                    }
                }
            },
        )
        manage.save_json(
            manage.METADATA_PATH,
            {
                'skills': {
                    'alpha': {
                        'recommendation': 3,
                        'description': 'Alpha',
                        'trigger': '',
                    },
                    'beta': {
                        'recommendation': 3,
                        'description': 'Beta',
                        'trigger': '',
                    },
                }
            },
        )

    def tearDown(self):
        self.temp.cleanup()

    @patch.object(manage, 'finish')
    def test_activate_and_deactivate(self, finish):
        manage.command_deactivate(SimpleNamespace(name='alpha'))
        self.assertEqual(manage.read_active(), ['beta'])
        finish.assert_called_with(prune=True)

        manage.command_activate(SimpleNamespace(name='alpha'))
        self.assertEqual(manage.read_active(), ['beta', 'alpha'])
        finish.assert_called_with(link=True)

    @patch.object(manage, 'finish')
    def test_move_updates_source_category(self, finish):
        manage.command_move(SimpleNamespace(name='alpha', category='backend'))
        moved = os.path.join(manage.SKILLS_DIR, 'backend', 'alpha', 'SKILL.md')
        self.assertTrue(os.path.isfile(moved))
        sources = manage.load_json(manage.SOURCES_PATH)
        self.assertEqual(sources['skills']['alpha']['category'], 'backend')
        finish.assert_called_with(link=True)

    @patch.object(manage, 'finish')
    def test_detach_removes_only_source(self, finish):
        manage.command_detach(SimpleNamespace(name='alpha'))
        self.assertNotIn('alpha', manage.load_json(manage.SOURCES_PATH)['skills'])
        self.assertIn('alpha', manage.load_json(manage.METADATA_PATH)['skills'])
        self.assertTrue(os.path.isdir(os.path.join(manage.SKILLS_DIR, 'tools', 'alpha')))
        finish.assert_called_once_with()

    @patch.object(manage, 'finish')
    def test_describe_updates_structured_metadata(self, finish):
        manage.command_describe(
            SimpleNamespace(
                name='alpha',
                description='新说明',
                trigger='装技能时使用',
                recommendation=5,
            )
        )
        record = manage.load_json(manage.METADATA_PATH)['skills']['alpha']
        self.assertEqual(record['description'], '新说明')
        self.assertEqual(record['trigger'], '装技能时使用')
        self.assertEqual(record['recommendation'], 5)
        finish.assert_called_once_with()

    @patch.object(manage, 'finish')
    def test_remove_cleans_every_registry_and_managed_links(self, finish):
        source = os.path.join(manage.SKILLS_DIR, 'tools', 'alpha')
        for dest in manage.DESTS:
            os.makedirs(dest, exist_ok=True)
            os.symlink(source, os.path.join(dest, 'alpha'))

        manage.command_remove(SimpleNamespace(name='alpha', yes=True))

        self.assertFalse(os.path.exists(source))
        self.assertNotIn('alpha', manage.read_active())
        self.assertNotIn('alpha', manage.load_json(manage.SOURCES_PATH)['skills'])
        self.assertNotIn('alpha', manage.load_json(manage.METADATA_PATH)['skills'])
        for dest in manage.DESTS:
            self.assertFalse(os.path.lexists(os.path.join(dest, 'alpha')))
        finish.assert_called_with(prune=True)


if __name__ == '__main__':
    unittest.main()
