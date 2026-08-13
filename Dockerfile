# Use the lightweight Nginx image from Docker Hub
FROM nginx:alpine

# Copy your local website files into the Nginx web root directory
COPY src/ /usr/share/nginx/html

# Expose port 80 to allow web traffic
EXPOSE 80
