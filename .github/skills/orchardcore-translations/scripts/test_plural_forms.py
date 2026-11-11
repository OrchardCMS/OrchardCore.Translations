import unittest

from plural_forms import plural_count


class PluralFormsTests(unittest.TestCase):
    def test_accepts_gettext_rules_and_all_supported_operators(self):
        expressions = [
            "0", "n != 1", "n > 1",
            "(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2",
            "n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && "
            "(n%100<12 || n%100>14) ? 1 : 2",
            "n==0 ? 0 : n==1 ? 1 : n==2 ? 2 : n%100>=3 && "
            "n%100<=10 ? 3 : n%100>=11 ? 4 : 5",
            "(n == 0 || n == 1) ? 0 : (n != 0 && n % 1000000 == 0) ? 2 : 1",
            "!(n >= 2) || n < 4 && n == 3 ? (n + 1) * 2 / 3 % 4 : n - 1",
            "n ? n ? 0 : 1 : 2", "n ? 0 : n ? 1 : 2", "!!n",
            "n / 0", "n % 0", "9223372036854775807", "0 - 1",
        ]
        for expression in expressions:
            with self.subTest(expression=expression):
                self.assertEqual(plural_count(
                    f"nplurals=6; plural={expression};", "test"
                ), 6)

    def test_accepts_runtime_header_order_case_and_last_duplicate_field(self):
        for header in (
            "plural=n != 1; nplurals=2",
            " NPLURALS = 2 ; PLURAL = n != 1 ; ; ",
            "nplurals=101; plural=bad; nplurals=2; plural=n != 1;",
        ):
            with self.subTest(header=header):
                self.assertEqual(plural_count(header, "test"), 2)

    def test_rejects_invalid_or_unsupported_input(self):
        headers = [
            None, "", "nplurals=0; plural=0;", "nplurals=101; plural=0;",
            "nplurals=-1; plural=0;", "nplurals=2.0; plural=0;",
            "nplurals=2;", "plural=0;", "nplurals=2; plural=;",
            "nplurals=2; plural=n; unknown=0;",
        ]
        expressions = [
            "not_a_gettext_expression", "n & 1", "n | 1", "n ^ 1", "n = 1",
            "n << 1", "n >> 1", "n ** 2", "-n", "+n", "n +", "n ! 1",
            "n ? 0", "n ? : 1", "(n", "n)", "n ? 0 : 1 : 2",
            "N", "n2", "n n", "1.5", "n[0]", "f(n)", "0x10",
            "9223372036854775808", "١", "n != = 1",
        ]
        headers.extend(f"nplurals=2; plural={expression};" for expression in expressions)
        for header in headers:
            with self.subTest(header=header):
                with self.assertRaisesRegex(ValueError, "test: invalid or unsupported"):
                    plural_count(header, "test")

    def test_matches_runtime_expression_length_and_depth_limits(self):
        self.assertEqual(plural_count("nplurals=100; plural=0;", "test"), 100)
        expression = "n" + " " * 1021 + "+0"
        self.assertEqual(plural_count(f"nplurals=2; plural={expression};", "test"), 2)
        with self.assertRaisesRegex(ValueError, "1024"):
            plural_count(f"nplurals=2; plural={expression}0;", "test")
        for expression in (
            "(" * 63 + "n" + ")" * 63,
            "!" * 63 + "n",
            "n?" * 63 + "0" + ":0" * 63,
        ):
            with self.subTest(expression=expression):
                self.assertEqual(plural_count(
                    f"nplurals=2; plural={expression};", "test"
                ), 2)
                with self.assertRaisesRegex(ValueError, "nesting limit"):
                    plural_count(f"nplurals=2; plural=({expression});", "test")


if __name__ == "__main__":
    unittest.main()
