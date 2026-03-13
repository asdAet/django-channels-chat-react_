from django.test import SimpleTestCase

from roles.permissions import Perm, has_perm


class PermissionBitsTests(SimpleTestCase):
    def test_has_perm_checks_admin_override_and_direct_bit(self):
        self.assertTrue(has_perm(int(Perm.ADMINISTRATOR), Perm.MANAGE_ROLES))
        self.assertTrue(has_perm(int(Perm.READ_MESSAGES | Perm.SEND_MESSAGES), Perm.SEND_MESSAGES))
        self.assertFalse(has_perm(int(Perm.READ_MESSAGES), Perm.SEND_MESSAGES))
