"""Coverage test for compatibility re-export module chat.direct_inbox."""

from django.test import SimpleTestCase

from chat import direct_inbox


class ChatDirectInboxModuleTests(SimpleTestCase):
    def test_module_reexports_state_functions(self):
        self.assertTrue(callable(direct_inbox.mark_unread))
        self.assertTrue(callable(direct_inbox.mark_read))
        self.assertTrue(callable(direct_inbox.get_unread_state))
