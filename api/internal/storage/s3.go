package storage

import (
	"context"
	"fmt"
	"io"
	"time"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// S3Handler implements the Handler interface for S3-compatible storage
// (AWS S3, Cloudflare R2, MinIO, etc.).
type S3Handler struct {
	client *s3.Client
	bucket string
}

// NewS3 creates an S3Handler with the given configuration.
// For non-AWS endpoints (R2, MinIO), pass the full endpoint URL.
func NewS3(endpoint, region, bucket, accessKey, secretKey string) (*S3Handler, error) {
	if region == "" {
		region = "auto"
	}

	opts := []func(*awsconfig.LoadOptions) error{
		awsconfig.WithRegion(region),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(accessKey, secretKey, ""),
		),
	}
	if endpoint != "" {
		opts = append(opts, awsconfig.WithBaseEndpoint(endpoint))
	}

	cfg, err := awsconfig.LoadDefaultConfig(context.Background(), opts...)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}

	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		if endpoint != "" {
			o.UsePathStyle = true
		}
	})

	return &S3Handler{
		client: client,
		bucket: bucket,
	}, nil
}

// Put uploads an object to S3.
func (h *S3Handler) Put(ctx context.Context, key string, reader io.Reader, size int64) error {
	input := &s3.PutObjectInput{
		Bucket:        &h.bucket,
		Key:           &key,
		Body:          reader,
		ContentLength: &size,
	}
	_, err := h.client.PutObject(ctx, input)
	if err != nil {
		return fmt.Errorf("s3 put %s: %w", key, err)
	}
	return nil
}

// Get retrieves an object from S3.
func (h *S3Handler) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	resp, err := h.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: &h.bucket,
		Key:    &key,
	})
	if err != nil {
		return nil, fmt.Errorf("s3 get %s: %w", key, err)
	}
	return resp.Body, nil
}

// Delete removes one or more objects from S3.
func (h *S3Handler) Delete(ctx context.Context, keys []string) error {
	for _, key := range keys {
		k := key
		_, err := h.client.DeleteObject(ctx, &s3.DeleteObjectInput{
			Bucket: &h.bucket,
			Key:    &k,
		})
		if err != nil {
			return fmt.Errorf("s3 delete %s: %w", key, err)
		}
	}
	return nil
}

// Source generates a presigned GET URL for the object.
func (h *S3Handler) Source(ctx context.Context, key string, expires time.Duration) (string, error) {
	presigner := s3.NewPresignClient(h.client)
	req, err := presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: &h.bucket,
		Key:    &key,
	}, s3.WithPresignExpires(expires))
	if err != nil {
		return "", fmt.Errorf("s3 presign %s: %w", key, err)
	}
	return req.URL, nil
}
