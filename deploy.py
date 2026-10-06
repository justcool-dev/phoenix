#!/usr/bin/env python3
"""
JC VPN - Master Deployer for Local or Remote SSH Setup
Supports direct local installation on Ubuntu or remote deployment over SSH.
"""

import os
import sys
import getpass
import subprocess
import time

def check_paramiko():
    try:
        import paramiko
        return paramiko
    except ImportError:
        print("[!] Installation du paquet paramiko...")
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "paramiko"])
        except subprocess.CalledProcessError:
            # Handle PEP 668 externally-managed environment on Ubuntu 24.04+
            subprocess.check_call([sys.executable, "-m", "pip", "install", "paramiko", "--break-system-packages"])
        import paramiko
        return paramiko

def run_local_install():
    print("\n==================================================")
    print(" 🚀 EXECUTION DE L'INSTALLATION LOCALE SUR UBUNTU ")
    print("==================================================")
    script_dir = os.path.dirname(os.path.abspath(__file__))
    setup_script = os.path.join(script_dir, "server", "scripts", "setup-all.sh")
    if not os.path.exists(setup_script):
        setup_script = os.path.join(script_dir, "scripts", "setup-all.sh")
    
    if not os.path.exists(setup_script):
        print(f"[ERROR] Impossible de trouver setup-all.sh à {setup_script}")
        sys.exit(1)

    cmd = ["sudo", "bash", setup_script]
    subprocess.check_call(cmd)

def main():
    print("==================================================")
    print("        JC VPN - INSTALLATEUR SERVEUR             ")
    print("==================================================")

    mode = input("Où souhaitez-vous installer le serveur ?\n [1] Directement sur CE serveur Ubuntu (Local)\n [2] À distance via SSH (Depuis votre PC Windows/Mac)\nChoix [1]: ").strip() or "1"

    if mode == "1":
        run_local_install()
        return

    # Remote SSH installation
    if len(sys.argv) >= 2:
        host = sys.argv[1]
    else:
        host = input("-> Adresse IP du serveur Ubuntu distant (ex: 5.231.118.126): ").strip()

    if not host or host in ['127.0.0.1', 'localhost']:
        run_local_install()
        return

    username = input("-> Utilisateur SSH [root]: ").strip() or "root"
    port_str = input("-> Port SSH [22]: ").strip() or "22"
    port = int(port_str)

    auth_choice = input("-> Authentification ([P]assword / [K]ey file) [P]: ").strip().upper() or "P"
    
    password = None
    key_filename = None

    if auth_choice == "K":
        key_filename = input("-> Chemin de la clé privée SSH: ").strip()
    else:
        password = getpass.getpass("-> Mot de passe SSH: ")

    paramiko = check_paramiko()

    print(f"\n[1/4] Connexion SSH à {username}@{host}:{port}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(
            hostname=host,
            port=port,
            username=username,
            password=password,
            key_filename=key_filename,
            timeout=15
        )
        print("✔ Connexion SSH réussie !")
    except Exception as e:
        print(f"[ERROR] Impossible de se connecter en SSH: {e}")
        sys.exit(1)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    server_dir = os.path.join(script_dir, "server")
    if not os.path.exists(os.path.join(server_dir, "package.json")):
        server_dir = script_dir

    print(f"[2/4] Création du répertoire distant /opt/jcvpn/server...")
    ssh.exec_command("mkdir -p /opt/jcvpn/server")

    print("[3/4] Envoi des fichiers du serveur via SFTP...")
    sftp = ssh.open_sftp()

    def upload_dir(local_path, remote_path):
        for item in os.listdir(local_path):
            if item in ['.git', 'node_modules', 'dist', 'coverage', 'logs']:
                continue
            l_path = os.path.join(local_path, item)
            r_path = f"{remote_path}/{item}".replace('\\', '/')
            if os.path.isdir(l_path):
                try:
                    sftp.mkdir(r_path)
                except IOError:
                    pass
                upload_dir(l_path, r_path)
            else:
                print(f"  Transfert de {item}...")
                sftp.put(l_path, r_path)

    upload_dir(server_dir, "/opt/jcvpn/server")
    sftp.close()

    print("\n[4/4] Lancement de l'installation automatique sur Ubuntu...")
    remote_cmd = "export DEBIAN_FRONTEND=noninteractive; cd /opt/jcvpn/server && chmod +x scripts/*.sh && bash scripts/setup-all.sh"
    
    channel = ssh.get_transport().open_session()
    channel.get_pty()
    channel.exec_command(remote_cmd)

    while True:
        if channel.recv_ready():
            output = channel.recv(4096).decode('utf-8', errors='ignore')
            sys.stdout.write(output)
            sys.stdout.flush()
        if channel.recv_stderr_ready():
            err_output = channel.recv_stderr(4096).decode('utf-8', errors='ignore')
            sys.stderr.write(err_output)
            sys.stderr.flush()
        if channel.exit_status_ready():
            while channel.recv_ready():
                sys.stdout.write(channel.recv(4096).decode('utf-8', errors='ignore'))
                sys.stdout.flush()
            break
        time.sleep(0.05)

    exit_code = channel.recv_exit_status()
    ssh.close()

    if exit_code == 0:
        print("\n==================================================")
        print(" 🎉 DÉPLOIEMENT RÉUSSI AVEC SUCCÈS !")
        print("==================================================")
        print(f" Accès Web Admin : http://{host}:9300/admin")
        print(" Identifiant     : admin")
        print(" Mot de passe   : admin123")
        print("==================================================")
    else:
        print(f"\n[ERROR] Échec avec le code de sortie {exit_code}.")

if __name__ == "__main__":
    main()
