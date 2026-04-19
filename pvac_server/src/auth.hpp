/*
    Authentication Module
    
    Handles auth token generation, storage, and validation
    Token is stored in ~/.octwa/pvac_token
*/

#pragma once
#include <string>
#include <fstream>
#include <random>
#include <iomanip>
#include <sstream>
#include <sys/stat.h>

#ifdef _WIN32
#include <direct.h>
#include <shlobj.h>
#define mkdir(path, mode) _mkdir(path)
#else
#include <unistd.h>
#include <pwd.h>
#endif

namespace pvac {

class Auth {
private:
    std::string token_;
    std::string token_path_;
    
    std::string get_home_dir() {
#ifdef _WIN32
        char path[MAX_PATH];
        if (SUCCEEDED(SHGetFolderPathA(NULL, CSIDL_PROFILE, NULL, 0, path))) {
            return std::string(path);
        }
        return "";
#else
        const char* home = getenv("HOME");
        if (home) return std::string(home);
        
        struct passwd* pw = getpwuid(getuid());
        if (pw) return std::string(pw->pw_dir);
        
        return "";
#endif
    }
    
    std::string generate_token() {
        // Generate 32-byte random token
        std::random_device rd;
        std::mt19937 gen(rd());
        std::uniform_int_distribution<> dis(0, 255);
        
        std::stringstream ss;
        ss << std::hex << std::setfill('0');
        for (int i = 0; i < 32; i++) {
            ss << std::setw(2) << dis(gen);
        }
        return ss.str();
    }
    
    bool ensure_dir(const std::string& path) {
        struct stat st;
        if (stat(path.c_str(), &st) == 0) {
#ifdef _WIN32
            return (st.st_mode & _S_IFDIR) != 0;
#else
            return S_ISDIR(st.st_mode);
#endif
        }
        
#ifdef _WIN32
        return _mkdir(path.c_str()) == 0;
#else
        return mkdir(path.c_str(), 0700) == 0;
#endif
    }
    
    bool save_token() {
        std::ofstream file(token_path_, std::ios::binary);
        if (!file) {
            std::cerr << "Failed to save token to: " << token_path_ << std::endl;
            return false;
        }
        
        file << token_;
        file.close();
        
        // Set file permissions (read/write for owner only)
#ifndef _WIN32
        chmod(token_path_.c_str(), 0600);
#endif
        
        return true;
    }
    
    bool load_token() {
        std::ifstream file(token_path_, std::ios::binary);
        if (!file) {
            return false;
        }
        
        std::string loaded_token;
        std::getline(file, loaded_token);
        file.close();
        
        // Validate token format (64 hex chars)
        if (loaded_token.length() == 64) {
            token_ = loaded_token;
            return true;
        }
        
        return false;
    }

public:
    Auth() {}
    
    bool init() {
        // Get home directory
        std::string home = get_home_dir();
        if (home.empty()) {
            std::cerr << "Failed to get home directory" << std::endl;
            return false;
        }
        
        // Create .octwa directory
        std::string octwa_dir = home + "/.octwa";
        if (!ensure_dir(octwa_dir)) {
            std::cerr << "Failed to create directory: " << octwa_dir << std::endl;
            return false;
        }
        
        // Set token path
        token_path_ = octwa_dir + "/pvac_token";
        
        // Try to load existing token
        if (load_token()) {
            return true;
        }
        
        // Generate new token
        token_ = generate_token();
        if (!save_token()) {
            std::cerr << "Failed to save auth token" << std::endl;
            return false;
        }
        
        return true;
    }
    
    bool validate(const std::string& token) const {
        return token == token_;
    }
    
    std::string get_token() const {
        return token_;
    }
    
    std::string get_token_path() const {
        return token_path_;
    }
};

} // namespace pvac
