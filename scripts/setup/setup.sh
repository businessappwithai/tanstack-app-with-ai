#!/bin/bash

# APPWITHAI Setup Script
# This script checks prerequisites, installs dependencies, and builds all packages

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}ℹ ${NC}$1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_header() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

print_header "APPWITHAI Setup"

# Step 1: Check Prerequisites
print_header "Step 1: Checking Prerequisites"

# Check for Bun
if command_exists bun; then
    BUN_VERSION=$(bun --version)
    print_success "Bun is installed (version $BUN_VERSION)"
else
    print_error "Bun is not installed"
    print_info "Please install Bun from https://bun.sh"
    print_info "Run: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# Check Bun version (exactly 1.4.4, and no other)
REQUIRED_BUN_VERSION="1.4.4"
if [ "$BUN_VERSION" = "$REQUIRED_BUN_VERSION" ]; then
    print_success "Bun version is $REQUIRED_BUN_VERSION"
else
    print_warning "Bun $BUN_VERSION is not $REQUIRED_BUN_VERSION, the only version this project uses"
    print_info "Install it: curl -fsSL https://bun.sh/install | bash -s bun-v$REQUIRED_BUN_VERSION"
fi

# Check for Node.js (optional, but good to have)
if command_exists node; then
    NODE_VERSION=$(node --version)
    print_success "Node.js is installed ($NODE_VERSION)"
else
    print_warning "Node.js is not installed (optional, but recommended)"
fi

# Check for Git
if command_exists git; then
    print_success "Git is installed"
else
    print_warning "Git is not installed (optional)"
fi

# Step 2: Check Environment File
print_header "Step 2: Checking Environment Configuration"

if [ -f ".env" ]; then
    print_success ".env file exists"
else
    if [ -f ".env.example" ]; then
        print_warning ".env file not found, copying from .env.example"
        cp .env.example .env
        print_success "Created .env file from .env.example"
        print_info "Please review and update .env with your API keys"
    else
        print_error ".env.example not found"
        exit 1
    fi
fi

# Step 3: Clean Previous Builds
print_header "Step 3: Cleaning Previous Builds"

print_info "Removing old build artifacts..."
rm -rf packages/*/dist
rm -rf packages/*/.next
rm -rf .next
print_success "Cleaned build artifacts"

# Step 4: Install Dependencies
print_header "Step 4: Installing Dependencies"

print_info "Running bun install..."
bun install
print_success "Dependencies installed"

# Step 5: Build Packages
print_header "Step 5: Building Packages"

print_info "Building @appwithai/core..."
bun run build:core
print_success "@appwithai/core built successfully"

print_info "Building @appwithai/generator..."
bun run build:generator
print_success "@appwithai/generator built successfully"

print_info "Building @appwithai/ai..."
bun run build:ai
print_success "@appwithai/ai built successfully"

print_info "Building @appwithai/web..."
bun run build:web
print_success "@appwithai/web built successfully"

# Step 6: Verify Installation
print_header "Step 6: Verifying Installation"

# Check if dist directories exist
PACKAGES=("core" "generator" "ai" "web")
ALL_BUILT=true

for pkg in "${PACKAGES[@]}"; do
    if [ -d "packages/$pkg/dist" ]; then
        print_success "packages/$pkg/dist exists"
    else
        print_error "packages/$pkg/dist not found"
        ALL_BUILT=false
    fi
done

# Final Summary
print_header "Setup Complete"

if [ "$ALL_BUILT" = true ]; then
    print_success "All packages built successfully!"
    echo ""
    print_info "You can now run the application with:"
    echo -e "  ${GREEN}./start.sh${NC}  - Start the development server"
    echo -e "  ${GREEN}./stop.sh${NC}   - Stop the development server"
    echo ""
    print_info "Or manually with:"
    echo -e "  ${GREEN}bun run dev${NC}  - Start the web application"
    echo ""
else
    print_error "Some packages failed to build. Please check the errors above."
    exit 1
fi
