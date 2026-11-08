"""Local-only, one-time first administrator provisioning. No default credentials."""
import argparse
import getpass
import sqlite3
from pathlib import Path

from history import HistoryStore


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command",choices=["bootstrap-admin","status"])
    parser.add_argument("--db",default=str(Path(__file__).parent/"data"/"aura.sqlite3"))
    parser.add_argument("--username")
    parser.add_argument("--name")
    args=parser.parse_args()
    store=HistoryStore(args.db)
    try:
        if args.command == "status":
            print("Administrator bootstrap is closed." if store.auth.initialized() else "No accounts exist. Run bootstrap-admin locally.")
            return
        if store.auth.initialized():
            raise ValueError("An account already exists; bootstrap will not replace it")
        username=args.username or input("Administrator username: ").strip()
        name=args.name or input("Display name: ").strip()
        password=getpass.getpass("Password (15–128 characters): ")
        if password != getpass.getpass("Confirm password: "):
            raise ValueError("Passwords do not match")
        user=store.auth.bootstrap_admin(username,name,password)
        print(f"Administrator provisioned. User ID: {user['user_id']}. Sign in with the credentials you entered.")
    except (ValueError,sqlite3.Error) as exc:
        parser.exit(1,f"Setup failed: {exc}\n")
    finally:
        store.close()


if __name__ == "__main__": main()
